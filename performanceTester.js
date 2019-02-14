const puppeteer = require('puppeteer');
const fs = require('fs');
// const {TimeoutError} = require('puppeteer/Errors');

    // move to other file
function isEmpty(obj) {
    for(var key in obj) {
            return false;
    }
    return true;
}


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
        let file = fs.readFileSync(filename, 'utf8');
        config = JSON.parse(file);

        if( config.loginParameters === undefined) throw 'Configuraion file does not contain "loginParameters" field.';
        if( config.loginParameters.username === undefined ) throw 'Configuraion file does not contain "loginParameters.username" field.';
        if( config.loginParameters.password === undefined ) throw 'Configuraion file does not contain "loginParameters.password" field.';
        if( config.loginParameters.loginUrl === undefined ) throw 'Configuraion file does not contain "loginParameters.loginUrl" field.';

        if( config.executionParameters === undefined) throw 'Configuraion file does not contain "executionParameters" field.';

        if( config.tests === undefined) throw 'Configuraion file does not contain "tests" field.';

    }
    catch(e){
        throw e;
    }
    
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

    const browser = await puppeteer.launch(params);
    const page = await browser.newPage();
    await page.setDefaultNavigationTimeout(60000); // 1 minutes
    await page.setDefaultTimeout(240000); // 4 minutes

    browser.on('targetchanged', () => {
        page.bringToFront();
    });
    

    //// login ////
    try{
        await page.goto(loginParams.loginUrl);

        await page.type('#UserLogin', loginParams.username);
        await page.type('#Password', loginParams.password);
        await page.click('input[type="submit"]');
        // await page.waitForNavigation();
        
            
    }catch(e){
        // TODO: log to file
        throw e;
    }


    // TODO: add listeners for: close, dialog,
    page.on('requestfailed', request => {
            // emits when reloading page with filters without waiting
        if(request.failure().errorText !== 'net::ERR_ABORTED'){
            console.log('Request failed: ' + request.url() + ' (METHOD: ' + request.method() + ', postData: ' + request.postData() + ') - ' + request.failure().errorText);
        }
    });
    page.on('error', e => {
        throw e;
    });
    page.on('pageerror', e => {
        let [response] = Promise.all(
            page.waitFor(10000),
            page.screenshot({'path' : 'pageerror-screenshots/' + Date.now(), 'fullpage' : true, })
        );
        throw e;
    });
    page.on('console', msg => {
        console.log('Message to console: ');
        console.log(msg);
    });



    return {browser, page};
};

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
    
    // console.log();
    // console.log('Go to: ', url);

    await page.setCacheEnabled(true);
    await page.goto(url, {waitUntil: ['load','domcontentloaded','networkidle0','networkidle2']});
    // await page.waitFor(5000);

        // TODO potentional issue 
    let mainUrl = '';
    if(url.slice(-5) === '/List') mainUrl = url.slice(0, -5);
    else mainUrl = url;
        ////////////////// 


    // console.log('Processing commands...');

    let commands = {};
        

    let b = await page.waitForSelector('.filter-control > .filter-actions > .k-button:last-child');
    // console.log('Selector found');
    let a = await page.click('.filter-control > .filter-actions > .k-button:last-child', {'delay' : 100}); // Reset Filters button
    // console.log('Button clicked');
    await page.waitForResponse(res => res.url().slice(-9) === 'List_Read');
    // console.log('Response is gotten');

    // console.log('Filters reseted');

    if( !isEmpty(testParams)){
        // console.log('Parameters for test:');

        try{

            for(param in testParams){
                
                // console.log(param, ' - ', testParams[param]);

                if(param.slice(0, 2) === '~~'){  // if it's command
                    // console.log('Command detected: ', param);
                    commands[param] = testParams[param];
                    continue;   
                }
                await page.type('#' + param, new String(testParams[param]));
            }
            
            // console.log('Parameters specified. Click Refresh button.');
            await page.click('.filter-actions > button[type="button"]:first-child'); // Refresh button

        }catch(e){
            throw e;
        }
    }

        // update page couple times to get correctly average values

    // console.log('Update page one more time...');
    await page.goto(url, {waitUntil: 'networkidle0'});
    await page.waitFor(500);


    let requestsData = {};
    let curRequestsData = {};

    let firstRequestTime = -1;
    let lastResponseTime = -1;

    const client = await page.target().createCDPSession();
    await client.send('Network.enable');
    client.on('Network.requestWillBeSent', (request) => {
        
        let key = request['requestId'];
        let newRequest = {
            'url': request['request']['url'],
            'method' : request['request']['method'],
            'postData' : request['request']['postData'],
            'resourceType' : request['type'],
            'startTimestamp' : request['timestamp'],
            'responseTimestamp' : undefined,
            'responseTime' : 0,
            'downloadTimestamp' : undefined,
            'downloadTime' : 0
        }

        curRequestsData[key] = newRequest;

        if(firstRequestTime === -1){
            firstRequestTime = request['timestamp'];
        }
    });
    client.on('Network.responseReceived', (response) => {

        try{
            let key = response['requestId'];
            curRequestsData[key]['responseTimestamp'] = response['timestamp'];

            let responseTime = (response['response']['timing']['receiveHeadersEnd'] - response['response']['timing']['sendEnd']);
            curRequestsData[key]['responseTime'] = responseTime > 0 ? responseTime : 0;

            // console.log(response['response']['timing']);
        }catch(e){
            
        }

    });
    client.on('Network.loadingFinished', (request) => {
        
        try{
            let key = request['requestId'];
            curRequestsData[key]['downloadTimestamp'] = request['timestamp'];

            let downloadTime = request['timestamp'] - curRequestsData[key]['responseTimestamp'];
            curRequestsData[key]['downloadTime'] += downloadTime > 0 ? downloadTime : 0;

            lastResponseTime = request['timestamp'];
        }catch(e){

        }

    });
    client.on('Network.loadingFailed', (request) => {
        try{
            let key = request['requestId'];
            delete curRequestsData[key];
        }catch(e){
            console.error(e);
        }
    });



    /// General cycle of time measurement
    let averageTime = 0;
    const iterations = 3;   

    // console.log('Lesteners setted. Let`s measure time...');

    for(let i=0; i < iterations; i++){
        // console.log('Iteration ', i, ' started.');

        curRequestsData = {};
        firstRequestTime = -1;
        lastResponseTime = 0;
        
        await page.reload({waitUntil: 'networkidle0'});
        // await page.waitFor(3000);

        // console.log('Page reloaded. Data is collected.');

        averageTime += (lastResponseTime - firstRequestTime);

        try{
            for(cmd in commands){
                
                // console.log('Executing commands: ', cmd);

                if(cmd === '~~download'){
                    await page.setDefaultTimeout(2400000); // 40 minutes for downloading reports

                    await page.click('.form-group > div > div[data-apply-filter] > .k-button');
                    
                    // console.log('Waiting for download...');
                    
                    await page.waitForResponse(response => {
                        let isOk = response.url() === mainUrl + '/ExportToExcel' || response.url() === mainUrl + '/Download'
                        return isOk;
                    });

                    // console.log('Response came. Let`s wait 1 second more...');

                    await page.waitFor(1000);

                    await page.setDefaultTimeout(240000); // returns to 4 minutes
                    
                    // console.log('Default Timeout setted.');
                }
            }
        }catch(e){
            console.error('Error while processing command for: ', url);

            throw e;
        }
        

        // console.log('Lets now collapse our data.');
            // add iteration data to general array (refactor)
        if(i === 0){
            requestsData = curRequestsData;
        }
        else{
            for(let data in requestsData){
                let isFound = false;
                for(let curData in curRequestsData){
                    if(requestsData[data].url === curRequestsData[curData].url && requestsData[data].method === curRequestsData[curData].method &&
                        requestsData[data].postData === curRequestsData[curData].postData && requestsData[data].resourceType === curRequestsData[curData].resourceType){
                            // items are equivalent
                            isFound = true;
                            requestsData[data].responseTime += curRequestsData[curData].responseTime;
                            requestsData[data].downloadTime += curRequestsData[curData].downloadTime;

                            break;
                    }
                }

                if(!isFound){
                    if( !requestsData[data].resourceType === 'Image' ){
                        console.log('That request does not found');
                        console.log( requestsData[data] );
                    }
                    requestsData[data].responseTime += requestsData[data].responseTime / i;
                    requestsData[data].downloadTime += requestsData[data].downloadTime / i;
                }
            }
        }

        // console.log('Iteration finished.');

    }


    // console.log('Getting average values..');
    // Getting average values
    for(let req in requestsData){
        requestsData[req]['responseTime'] = Math.round(requestsData[req]['responseTime'] / iterations * 100) / 100;
        requestsData[req]['downloadTime'] = Math.round(requestsData[req]['downloadTime'] / iterations * 100000) / 100;
    }
    averageTime = (averageTime / iterations).toFixed(2);
    
    // console.log('Lets finish..');

    client.send('Network.disable');

    // console.log('Returning measured data.');
    return {averageTime, 'timeMeasurementData': {'mainUrl': mainUrl, requestsData} };
};
