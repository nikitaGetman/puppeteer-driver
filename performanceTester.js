const puppeteer = require('puppeteer');
const fs = require('fs');
const {TimeoutError} = require('puppeteer/Errors');
const colors = require('colors');
const path = require('path');


let USER_CONFIG;


/*
    loadConfig - opens and parses *.json file, validates it.
        Returns object with specified parameters
        {
            filename - path to file ('configs/backoffice_test.json')
        }                                                                           
*/
exports.loadConfig = async function loadConfig(filename){
    
    let config;

    try{
            // load and parse configuration file
        let file = fs.readFileSync(filename, 'utf8');
        config = JSON.parse(file);

            // basic fields availability checks
        if( config.loginParameters === undefined) throw 'Configuraion file does not contain "loginParameters" field.';
        if( config.loginParameters.username === undefined ) throw 'Configuraion file does not contain "loginParameters.username" field.';
        if( config.loginParameters.password === undefined ) throw 'Configuraion file does not contain "loginParameters.password" field.';
        if( config.loginParameters.loginUrl === undefined ) throw 'Configuraion file does not contain "loginParameters.loginUrl" field.';

        if( config.executionParameters === undefined) throw 'Configuraion file does not contain "executionParameters" field.';

        if( config.tests === undefined) throw 'Configuraion file does not contain "tests" field.';

    }
    catch(e){
            // throw error if file is invalid
        throw e;
    }
    
    USER_CONFIG = Object.assign({}, config);
    delete USER_CONFIG.tests;
    return config;
};

/*
    init - creates browser and page. And logging via specified in configuration file parameters
        Returns browser and page objects
        {
            params - parameters for puppeteer.launch()
            loginParams - parameters specified in configuration file, necessary for correct logging in system
        }
*/
exports.init = async function init(params, loginParams){

    let browser = {};
    let page = {};
    try{
            // Initailize browser and page objects
        browser = await puppeteer.launch(params);
        page = await browser.newPage();

        await page.setDefaultNavigationTimeout(120000); // 2 minute
        await page.setDefaultTimeout(600000); // 10 minutes


        browser.on('targetchanged', () => {
            // page.activeResponses = 0;
            page.bringToFront();
        });
        

            // Login to backoffice
        try{
            await page.goto(loginParams.loginUrl);

            await page.type('#UserLogin', loginParams.username, {'delay': 10});
            await page.type('#Password', loginParams.password, {'delay': 10});
            await page.click('input[type="submit"]');
            await page.waitFor(1000);
            // await page.reload({'waitUntil' : 'domcontentloaded'});
                
        }catch(e){
                // if can not login 
            throw e;
        }

        
        page.activeResponses = 0;
        page.on('request', r => {
            page.activeResponses++;
        });
        page.on('requestfailed', r => {
            page.activeResponses--;
        });
        page.on('requestfinished', r => {
            page.activeResponses--;
        });

            // Specify listeners for page events
        page.on('requestfailed', request => {
            if(request.failure().errorText !== 'net::ERR_ABORTED'){
                console.error('Request failed: ' + request.url() + ' (METHOD: ' + request.method() + ', postData: ' + request.postData() + ') - ' + request.failure().errorText);
            }
        });
        page.on('error', e => {
            throw e;
        });
        page.on('dialog', e => {
            console.error('Dialog event happened');
            throw e;
        });
        page.on('pageerror', e => {
            const pathForScreenshots = 'pageerror-screenshots/';

            if(!fs.existsSync(pathForScreenshots)){
                fs.mkdirSync(pathForScreenshots);
            }

                // wait and create screenshot before exception
            Promise.all([
                page.waitFor(10000),
                page.screenshot({'path' : pathForScreenshots + Date.now() + '.png', 'fullPage' : true, 'type' : 'png'})
            ]).then(() => {
                throw e;
            });

        });
        page.on('console', msg => {
            if( msg['_location']['url'] !== 'https://testing1.kontocloud.com:8443/favicon.ico' && msg['_type'] !== 'verbose' && msg['_type'] !== 'info'){
                console.error('Message to console: ');
                console.error(msg);
            }
            if(msg['_type'] === 'error'){
                throw {'consoleMessage': msg['_text'], 'url': msg['_location']['url']};
            }
        });


        return {browser, page};
    }
    catch(e){

        try{
            await page.close();
            // await browser.close();
            await setTimeout(()=>{
                browser.close();
            }, 1000);
        }catch(err){}

        throw e;
    }
};

function setMarkers(command){

    if(typeof command === 'string'){

        const timestamp_marker = '[timestamp]';
        const today_date_marker = '[date_today]';
        const seconds_marker = '[timestamp.5]';
        const password_marker = '[password]';
        const randnum_marker = '[randnum]';

        let val = command;

        if(command.includes(timestamp_marker)){
            command = val.slice(0, val.indexOf(timestamp_marker)) + new String(Date.now()) + val.slice(val.indexOf(timestamp_marker) + timestamp_marker.length);
            
            command = setMarkers(command);
        }
        if(command.includes(seconds_marker)){
            command = val.slice(0, val.indexOf(seconds_marker)) + new String(Date.now() % 100000) + val.slice(val.indexOf(seconds_marker) + seconds_marker.length);
            
            command = setMarkers(command);
        }
        if(command.includes(password_marker)){
            command = val.slice(0, val.indexOf(password_marker)) + USER_CONFIG.loginParameters.password + val.slice(val.indexOf(password_marker) + password_marker.length);
            
            command = setMarkers(command);
        }
        if(command.includes(today_date_marker)){
            let date = new Date().getDate() + '.' + ('0' + (new Date().getMonth() + 1)).slice(-2) + '.' + new Date().getFullYear();
            command = val.slice(0, val.indexOf(today_date_marker)) + date + val.slice(val.indexOf(today_date_marker) + today_date_marker.length);
            
            command = setMarkers(command);
        }
        if(command.includes(randnum_marker)){
            const min = 0;
            const max = 9;

            let rand = min + Math.random() * (max + 1 - min);
            rand = Math.floor(rand);
            command = val.slice(0, val.indexOf(randnum_marker)) + rand + val.slice(val.indexOf(randnum_marker) + randnum_marker.length);

            command = setMarkers(command);
        }
    }


    return command;
}

async function executeCommand(command, page, mainUrl){
    for(key in command){

        command[key] = setMarkers(command[key]);

        if(key === '~~download'){
            
            let selector = command[key] !== '' ? command[key] : '.form-group > div > div[data-apply-filter] > .k-button';

                // checking that download btn is not disabled
            let downloadBtn = await page.$(selector);
            if(downloadBtn['_remoteObject']['description'].split('.').includes('disabled')){
                throw 'Download button is disabled.';
            }

                // click Download button
                // !! should not be await 
            page.click(selector, {'delay': 100});

            await page.waitForRequest(request => 
                {
                    let addUrl = mainUrl.slice(0, mainUrl.lastIndexOf('/') - mainUrl.length);
                    
                    let url = request.url(); 
                    let isOk = (url === mainUrl + '/ExportToExcel')
                            || (url === addUrl + '/AccountApplicationStatusDownload')
                            || (url === addUrl + '/AccountBalanceDownload')
                            || (url === addUrl + '/EWalletAccountTypeDownload')
                            || (url === addUrl + '/EWalletActivationDownload')
                            || (url === addUrl + '/EWalletUserStateDownload')
                            || (url === addUrl + '/ExternalAuthorizationDownload')
                            || (url === addUrl + '/ExternalPayoutDownload')
                            || (url === addUrl + '/FeeDownload')
                            || (url === addUrl + '/FraudTransactionsDownload')
                            || (url === 'https://testing1.kontocloud.com:8443/kontocloud/backoffice/Transaction/ExportToExcel')  
                            || (url === addUrl + '/KpiDownload')
                            || (url === addUrl + '/LoadingDownload')
                            || (url === addUrl + '/PaymentDownload')
                            || (url === addUrl + '/RiskScoreCardDownload')
                            || (url === addUrl + '/RiskTransactionsDownload')
                            || (url === addUrl + '/SentEmailsDownload')
                            || (url === addUrl + '/SummaryPayoutDownload')
                            || (url === addUrl + '/UnloadingDownload')
                            || (url === addUrl + '/UserStatisticsDownload')
                            || (url.split('?')[0] === mainUrl + '/Download');

                    if(!isOk){
                        console.log(isOk);
                        console.log(mainUrl);
                        console.log(addUrl);
                        console.log(url);
                    }
                    return isOk;
                }, {'timeout': 60000}); // wait 60 secs for request
           
            await page.waitForResponse(request => 
                {
                    let addUrl = mainUrl.slice(0, mainUrl.lastIndexOf('/') - mainUrl.length);
                    
                    let url = request.url(); 
                    let isOk = (url === mainUrl + '/ExportToExcel')
                            || (url === addUrl + '/AccountApplicationStatusDownload')
                            || (url === addUrl + '/AccountBalanceDownload')
                            || (url === addUrl + '/EWalletAccountTypeDownload')
                            || (url === addUrl + '/EWalletActivationDownload')
                            || (url === addUrl + '/EWalletUserStateDownload')
                            || (url === addUrl + '/ExternalAuthorizationDownload')
                            || (url === addUrl + '/ExternalPayoutDownload')
                            || (url === addUrl + '/FeeDownload')
                            || (url === addUrl + '/FraudTransactionsDownload')
                            || (url === 'https://testing1.kontocloud.com:8443/kontocloud/backoffice/Transaction/ExportToExcel')  
                            || (url === addUrl + '/KpiDownload')
                            || (url === addUrl + '/LoadingDownload')
                            || (url === addUrl + '/PaymentDownload')
                            || (url === addUrl + '/RiskScoreCardDownload')
                            || (url === addUrl + '/RiskTransactionsDownload')
                            || (url === addUrl + '/SentEmailsDownload')
                            || (url === addUrl + '/SummaryPayoutDownload')
                            || (url === addUrl + '/UnloadingDownload')
                            || (url === addUrl + '/UserStatisticsDownload')
                            || (url.split('?')[0] === mainUrl + '/Download');

                    return isOk;
                }, {'timeout': 2400000}); // wait 40 mins for response

        }
        else if(key === '~~focus'){
            let frames = await page.frames();

            let isFound = false;
            let err;

            for(i in frames){
                try{
                    await page.focus(command[key]);
                    isFound = true;
                    break;
                }catch(e){
                    err = e;
                }
            }

            if(!isFound){
                throw err;
            }
                // wait until all requests would be sent
            await page.waitFor(500);
        }
        else if(key === '~~click'){
            
            let frames = await page.frames();

            let isFound = false;
            let err;

            for(i in frames){
                try{
                    await page.click(command[key], {'delay': 100});
                    isFound = true;
                    break;
                }catch(e){
                    err = e;
                }
            }

            if(!isFound){
                throw err;
            }
                // wait until all requests would be sent
            await page.waitFor(500);
        }
        else if(key === '~~press'){
            await page.keyboard.press(command[key], {'delay': 100});      
        }
        else if(key === '~~delay'){
            await page.waitFor(command[key]);
        }
        else if(key === '~~eval'){
            let selector = Object.keys(command[key])[0];
            let func = eval(command[key][selector]);

            // console.log(selector);
            // console.log(func);
            await page.$$eval(selector, func);
        }
        else if(key === '~~upload'){
            const selector = Object.keys(command[key])[0];
            const filePath  = path.relative(process.cwd(), __dirname + command[key][selector]);
            
            if(!fs.existsSync(filePath)){
                throw "File path is not available: " + filePath;
            }

            const input = await page.$(selector);
            await input.uploadFile(filePath);
        }
        else if(key === '~~goto'){
            await page.goto(command[key]);
        }
        else if(key === '~~refresh'){
            let selector = command[key] !== '' ? command[key] : '.filter-actions > .k-button:first-child';
            
            await page.waitForSelector(selector, {'timeout': 1000});
            await page.click(selector, {'delay' : 100});
        }
        else if(key === '~~resetFilters'){
            let selector = command[key] !== '' ? command[key] : '.filter-actions > .k-button:last-child';
          
            await page.waitForSelector(selector, {'timeout': 1000});
            await page.click(selector, {'delay' : 100});
        }
        else if(key.slice(0,2) === '~~'){
            throw 'Unknown command: ' + JSON.stringify(command);
        }

        else{
            let frames = await page.frames();

            let isFound = false;
            let err;

            for(i in frames){
                try{
                    await frames[i].type(key, new String(command[key]));
                    isFound = true;
                    break;
                }catch(e){
                    err = e;
                }
            }

            if(!isFound){
                throw err;
            }
            
        }

    }
           
}
/*
    newTest - creates new performance test and measures requests time
        Returns average time for whole page and timings for each request
        {
            page - created page object
            url - url adress for testing
            testParams - filters values specified in configuration file
        }
*/
exports.newTest = async function newTest(page, url, testParams){

        // Load page first time
    await page.setCacheEnabled(true);
    await page.goto(url, {waitUntil: ['networkidle0']});


        // Get base url
    let mainUrl = url;

    let index = mainUrl.lastIndexOf('/');
    while(mainUrl.slice(index - mainUrl.length + 1) === 'List' || !isNaN(mainUrl.slice(index - mainUrl.length + 1))){
        mainUrl = mainUrl.slice(0, index - mainUrl.length);
        index = mainUrl.lastIndexOf('/');
    }
    
        ////////////////// 

        // Click Reset Filters button (if it`s exists)
    try{
        if(! url === 'https://dmd-vm.kontocloud.com/kontocloud/backoffice/RiskType/List'
            && ! url === 'https://dmd-vm.kontocloud.com/kontocloud/backoffice/RiskScore/List') 
        {
            await page.waitForSelector('.filter-actions > .k-button:last-child', {'timeout': 1000});
            await executeCommand({'~~resetFilters': ''}, page, mainUrl);
        }
    }catch(e){
        if(e instanceof TimeoutError){
            // console.error('Can not to find button with selector: .filter-control > .filter-actions > .k-button:last-child');
        }
        // else{
        //     console.log('Warning:'.bgYellow.black + ' tried to find resetButton and did not get TimeoutError'.underline.yellow);
        // }
        else throw e;
    }
    

        // Processing specified testParameters
    let iterationCommands = [];
    let specifiedIterationsCount = 0;
    if( testParams.length > 0 ){
        let forEachIterationFlag = false;

        for(let i=0; i < testParams.length; i++){
            try{
                if(testParams[i] === "~~ITERATION"){
                    forEachIterationFlag = true;
                    continue;
                }
                if(new String(testParams[i]).split('=')[0] === '~~ITERATIONS_COUNT'){
                    let tmp = new String(testParams[i]).split('=')[1];
                    specifiedIterationsCount =  tmp !== undefined && tmp > 0 ? tmp : 0;
                    continue;
                }
  
                if( !forEachIterationFlag ){
                        // if it's command
                    await executeCommand(testParams[i], page, mainUrl);
                }
                else{
                    iterationCommands.push(testParams[i]);
                }
                
            }catch(e){
                    // if can not specify parameter
                throw e;
            }
        }

            // click Refresh button (if it`s exists)
        try{
            if(! url === 'https://dmd-vm.kontocloud.com/kontocloud/backoffice/RiskType/List'
                && ! url === 'https://dmd-vm.kontocloud.com/kontocloud/backoffice/RiskScore/List') 
            {
                await page.waitForSelector('.filter-actions > .k-button:first-child', {'timeout': 1000});
                await executeCommand({'~~refresh': ''}, page, mainUrl);
            }
        }catch(e){
            if(e instanceof TimeoutError){
                // console.error('Can not to find button with selector: .filter-control > .filter-actions > .k-button:first-child');
            }
            
            else {
                throw e;
            }
        }

    }
        //////////////////////////////////
    
        // Update page couple times to get correct average values
    await page.reload(url, {waitUntil: 'networkidle0'});
    await page.waitFor(500);
    

        // Specify listeners for Request events
    let requestsData = {};
    let curRequestsData = {};

    let firstRequestTime = -1;
    let lastResponseTime = -1;

    page.activeResponses = 0;

    const client = await page.target().createCDPSession();
    await client.send('Network.enable');
        // Add request to array to track it

    let redirectTimestamp = 0;
    client.on('Network.requestWillBeSent', (request) => {

        let reqId = request['requestId'];

        if(curRequestsData[reqId]){
            if(curRequestsData[reqId]['responseTime'] == 0){
                curRequestsData[reqId]['responseTime'] = Date.now() - redirectTimestamp; 
            }
            
            curRequestsData['_' + reqId] = curRequestsData[reqId];
            delete curRequestsData[reqId];
        }
        
        redirectTimestamp = Date.now();
        
        let newRequest = {
            'url': request['request']['url'],
            'method' : request['request']['method'],
            'postData' : request['request']['postData'],
            'resourceType' : request['type'],
            'responseTime' : 0,
            'startDownloadTimestamp' : 0,
            'downloadTime' : 0
        }

        curRequestsData[reqId] = newRequest;
        // page.activeResponses++;

        if(firstRequestTime === -1){
            firstRequestTime = request['timestamp'];
        }
    });
        // Add server timing when response received
    client.on('Network.responseReceived', async (res) => {

        try{
            let response = res['response'];
            let reqId = res['requestId'];
            

                // if response does not served from cache
            if( !response['fromDiskCache'] && curRequestsData[reqId]){
                    // add timings
                curRequestsData[reqId]['responseTime'] = response['timing']['receiveHeadersEnd'] - response['timing']['sendEnd'];
                    // add startDownload timestamp if it is in black list 
                if( !(response['mimeType'] === 'font/x-woff' || response['mimeType'] === 'text/javascript' 
                        || response['mimeType'] === 'image/gif' || response['mimeType'] === 'image/png') ){

                    curRequestsData[reqId]['startDownloadTimestamp'] = response['timing']['requestTime'] + ( response['timing']['receiveHeadersEnd'] / 1000.0 );
        
                }
            }

        }catch(e){
            console.log('Receive request error:');
            console.log(e);
            throw e;
        }

    });
        // Add loading timing when request finished
    client.on('Network.loadingFinished', async (request) => {
        
        try{
            let reqId = request['requestId'];

            if( curRequestsData[reqId] && curRequestsData[reqId]['startDownloadTimestamp'] > 0){
                curRequestsData[reqId]['downloadTime'] = request['timestamp'] - curRequestsData[reqId]['startDownloadTimestamp'];;
            }

            // page.activeResponses--;

            lastResponseTime = request['timestamp'];
        }catch(e){
            console.log('loadingFinished unhandled request');
            console.log(e);
            throw e;
        }

    });
        // Delete request from array if it is failed
    client.on('Network.loadingFailed', async (request) => {
        try{
            let reqId = request['requestId'];

            delete curRequestsData[reqId];

            // page.activeResponses--;
        }catch(e){
            throw e;
        }
    });


        /// General cycle of time measurement
    let averageTime = 0;
    const iterations = 2;//specifiedIterationsCount > 0 ? specifiedIterationsCount : 3;   

    for(let i=0; i < iterations; i++){
            // set default values
        curRequestsData = {};
        page.activeResponses = 0;
        firstRequestTime = -1;
        lastResponseTime = 0;

            // reloading page and measure all metrics
        await page.reload({waitUntil: 'networkidle0'});

            // calculate page load time for this iteration
        averageTime += (lastResponseTime - firstRequestTime);

            // executing additional commands
        for(let i=0; i < iterationCommands.length; i++){
            
            try{
                page.activeResponses = 0;

                await executeCommand(iterationCommands[i], page, mainUrl);

                while(page.activeResponses > 0){
                    await page.waitFor(500);
                }

            }catch(e){
                let newMsg = 'Error while processing command for: ' + url + ' command: ' + JSON.stringify(iterationCommands[i]) + '\n' 
                                + ( typeof e === 'object' ? JSON.stringify(e) : e);
                // throw newMsg;
                throw e;
            }
                
        }
        
            ////////////////////////////////        

            // Add iteration data to general array
        if(i === 0){
            requestsData = curRequestsData;
        }
        else{
                // for each request in collapsed data
            for(let data in requestsData){
                
                let isFound = false;
                    // looking for the same element in new measured array
                for(let curData in curRequestsData){
                        //and if items are equivalent
                    if(requestsData[data].url === curRequestsData[curData].url && requestsData[data].method === curRequestsData[curData].method &&
                        requestsData[data].postData === curRequestsData[curData].postData && requestsData[data].resourceType === curRequestsData[curData].resourceType){
                                // summarize values and stop looking
                            isFound = true;
                            requestsData[data].responseTime += curRequestsData[curData].responseTime;
                            requestsData[data].downloadTime += curRequestsData[curData].downloadTime;

                            break;
                    }
                }
                    // if no match found, inform about it
                if(!isFound){
                    if( !requestsData[data].resourceType === 'Image' ){
                        console.error('That request does not found');
                        console.error( requestsData[data] );
                    }
                    requestsData[data].responseTime += requestsData[data].responseTime / i;
                    requestsData[data].downloadTime += requestsData[data].downloadTime / i;
                }
            }
        }
        curRequestsData = {};
    }
        /////////////////////////////////////


        // Average values
    for(let req in requestsData){
        requestsData[req]['responseTime'] = Math.round(requestsData[req]['responseTime'] / iterations * 100) / 100;     // to ms
        requestsData[req]['downloadTime'] = Math.round(requestsData[req]['downloadTime'] / iterations * 100000) / 100;  // to ms
    }
    averageTime = (averageTime / iterations * 1000).toFixed(2);    // to ms

        // Finishing execution
    await client.send('Network.disable');
    
    return {averageTime, 'timeMeasurementData': {'mainUrl': mainUrl, requestsData} };
};