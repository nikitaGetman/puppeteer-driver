const puppeteer = require('puppeteer');
const fs = require('fs');
const {TimeoutError} = require('puppeteer/Errors');

    // Checks that object is empty or not
function isEmpty(obj) {
    for(var key in obj) return false;
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

        // Initailize browser and page objects
    const browser = await puppeteer.launch(params);
    const page = await browser.newPage();

    await page.setDefaultNavigationTimeout(120000); // 2 minute
    await page.setDefaultTimeout(240000); // 4 minutes


    browser.on('targetchanged', () => {
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
        if( msg['_location']['url'] !== 'https://testing1.kontocloud.com:8443/favicon.ico' && msg['_type'] !== 'verbose'){
            console.error('Message to console: ');
            console.error(msg);
        }         
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

        // Load page first time
    await page.setCacheEnabled(true);
    await page.goto(url, {waitUntil: ['networkidle0']});


        // Slice main Url
    let mainUrl = '';
    let index = url.lastIndexOf('/');
    mainUrl = url.slice(0, index - url.length);
        ////////////////// 

        // Click Reset Filters button (if it`s exists)
    try{
        await page.waitForSelector('.filter-control > .filter-actions > .k-button:last-child', {'timeout': 1000});
        await page.click('.filter-control > .filter-actions > .k-button:last-child', {'delay' : 100});
        await page.waitFor(500); // TODO: is this pause necessary?    
    }catch(e){
        if(e instanceof TimeoutError){
            // console.error('Can not to find button with selector: .filter-control > .filter-actions > .k-button:last-child');
        }
        else throw e;
    }
    

        // Processing specified testParameters
    let commands = {};
    if( !isEmpty(testParams)){

        try{
            for(param in testParams){
                    // if it's command
                if(param.slice(0, 2) === '~~'){  
                    commands[param] = testParams[param];
                    continue;   
                }
                    // if it's parameter then spicify it
                await page.type('#' + param, new String(testParams[param]));
            }
                // click Refresh button (if it`s exists)
            try{
                await page.waitForSelector('.filter-control > .filter-actions > .k-button:first-child', {'timeout': 1000});
                await page.click('.filter-control > .filter-actions > .k-button:first-child', {'delay' : 100});
            }catch(e){
                if(e instanceof TimeoutError){
                    // console.error('Can not to find button with selector: .filter-control > .filter-actions > .k-button:first-child');
                }
                else throw e;
            }
            

        }catch(e){
                // if can not specify parameter
            throw e;
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

    let activeResponses = 0;

    const client = await page.target().createCDPSession();
    await client.send('Network.enable');
        // Add request to array to track it
    client.on('Network.requestWillBeSent', (request) => {
        
        let reqId = request['requestId'];
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
        activeResponses++;

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

            activeResponses--;

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

            activeResponses--;
        }catch(e){
            throw e;
        }
    });


        /// General cycle of time measurement
    let averageTime = 0;
    const iterations = 3;   

    for(let i=0; i < iterations; i++){
            // set default values
        curRequestsData = {};
        activeResponses = 0;
        firstRequestTime = -1;
        lastResponseTime = 0;

            // reloading page and measure all metrics
        await page.reload({waitUntil: 'networkidle0'});

            // calculate page load time for this iteration
        averageTime += (lastResponseTime - firstRequestTime);

            // executing additional commands
        try{
            for(cmd in commands){

                if(cmd === '~~download'){
                    await page.setDefaultTimeout(2400000); // 40 minutes for downloading reports
                        
                        // click Download button
                    await page.click('.form-group > div > div[data-apply-filter] > .k-button', {'delay' : 100});
                    
                        // wait untail all requests would be resolved
                    while(activeResponses > 0){
                        await page.waitFor(100);
                    }

                    await page.setDefaultTimeout(240000); // returns to 4 minutes
                }

                if(cmd == '~~click'){
                    await page.click(commands[cmd], {'delay': 100});

                    // wait untail all requests would be resolved
                    while(activeResponses > 0){
                        await page.waitFor(100);
                    }
                }
            }
        }catch(e){
            console.error('Error while processing command for: ', url);
            throw e;
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
    }
        /////////////////////////////////////


        // Average values
    for(let req in requestsData){
        requestsData[req]['responseTime'] = Math.round(requestsData[req]['responseTime'] / iterations * 100) / 100;     // to ms
        requestsData[req]['downloadTime'] = Math.round(requestsData[req]['downloadTime'] / iterations * 100000) / 100;  // to ms
    }
    averageTime = (averageTime / iterations * 1000).toFixed(2);    // to ms

        // Finishing execution
    // await client.send('Network.disable');
    
    return {averageTime, 'timeMeasurementData': {'mainUrl': mainUrl, requestsData} };
};

/*

,

        "Opening period dependent data grids with the data for the previous day (it should be less than or equal to 5 seconds)" : [

            {
                "name": "Transaction Management → Transactions",
                "url": "https://testing1.kontocloud.com:8443/kontocloud/backoffice/Transaction/List",
                "parameters": {
                    "CreationDateBottom" : "01.06.2018 00:00:00",
                    "CreationDateTop" : "01.06.2018 00:00:00"
                }
            },
            {
                "name": "Transaction Management → External Transactions",
                "url": "https://testing1.kontocloud.com:8443/kontocloud/backoffice/TransactionAcquiring/List",
                "parameters": {
                    "CreationDateBottom" : "01.06.2018 00:00:00",
                    "CreationDateTop" : "01.06.2018 00:00:00"
                }
            },
            {
                "name": "Transaction Management → Internal Transactions",
                "url": "https://testing1.kontocloud.com:8443/kontocloud/backoffice/TransactionIssuing/List",
                "parameters": {
                    "CreationDateBottom" : "01.06.2018 00:00:00",
                    "CreationDateTop" : "01.06.2018 00:00:00"
                }
            },
            {
                "name": "Transaction Management → Scheduled Transactions",
                "url": "https://testing1.kontocloud.com:8443/kontocloud/backoffice/ScheduledTransaction/List",
                "parameters" : {
                    "CreationDateFrom" : "16.06.2018 00:00:00",
                    "CreationDateTo" : "16.06.2018 00:00:00"
                }
            },
            {
                "name": "Transaction Management → Unsettled Transactions",
                "url": "https://testing1.kontocloud.com:8443/kontocloud/backoffice/UnsettledTransaction/List",
                "parameters" : {
                    "CreationDateBottom" : "17.01.2019",
                    "CreationDateTop" : "17.01.2019"
                }
            }
            
        ],

        "Opening period dependent data grids with the data for the previous month" : [

            {
                "name": "Transaction Management → Transactions",
                "url": "https://testing1.kontocloud.com:8443/kontocloud/backoffice/Transaction/List",
                "parameters": {
                    "CreationDateBottom" : "01.06.2018 00:00:00",
                    "CreationDateTop" : "30.06.2018 23:59:59"
                }
            },
            {
                "name": "Transaction Management → External Transactions",
                "url": "https://testing1.kontocloud.com:8443/kontocloud/backoffice/TransactionAcquiring/List",
                "parameters": {
                    "CreationDateBottom" : "01.06.2018 00:00:00",
                    "CreationDateTop" : "30.06.2018 23:59:59"
                }
            },
            {
                "name": "Transaction Management → Internal Transactions",
                "url": "https://testing1.kontocloud.com:8443/kontocloud/backoffice/TransactionIssuing/List",
                "parameters": {
                    "CreationDateBottom" : "01.06.2018 00:00:00",
                    "CreationDateTop" : "30.06.2018 23:59:59"
                }
            },
            {
                "name": "Transaction Management → Scheduled Transactions",
                "url": "https://testing1.kontocloud.com:8443/kontocloud/backoffice/ScheduledTransaction/List",
                "parameters" : {
                    "CreationDateFrom" : "01.06.2018 00:00:00",
                    "CreationDateTo" : "30.06.2018 23:59:59"
                }
            },
            {
                "name": "Transaction Management → Unsettled Transactions",
                "url": "https://testing1.kontocloud.com:8443/kontocloud/backoffice/UnsettledTransaction/List",
                "parameters" : {
                    "CreationDateBottom" : "01.06.2018",
                    "CreationDateTop" : "30.06.2018"
                }
            }

        ],

        "Opening period dependent data grids with the data for the period from the first day of the last month to today's date": [

            {
                "name": "Transaction Management → Transactions",
                "url": "https://testing1.kontocloud.com:8443/kontocloud/backoffice/Transaction/List",
                "parameters": {
                    "CreationDateBottom" : "01.01.2019 00:00:00"
                }
            },
            {
                "name": "Transaction Management → External Transactions",
                "url": "https://testing1.kontocloud.com:8443/kontocloud/backoffice/TransactionAcquiring/List",
                "parameters": {
                    "CreationDateBottom" : "01.01.2019 00:00:00"
                }
            },
            {
                "name": "Transaction Management → Internal Transactions",
                "url": "https://testing1.kontocloud.com:8443/kontocloud/backoffice/TransactionIssuing/List",
                "parameters": {
                    "CreationDateBottom" : "01.01.2019 00:00:00"
                }
            },
            {
                "name": "Transaction Management → Scheduled Transactions",
                "url": "https://testing1.kontocloud.com:8443/kontocloud/backoffice/ScheduledTransaction/List",
                "parameters" : {
                    "CreationDateFrom" : "01.06.2018 00:00:00"
                }
            },
            {
                "name": "Transaction Management → Unsettled Transactions",
                "url": "https://testing1.kontocloud.com:8443/kontocloud/backoffice/UnsettledTransaction/List",
                "parameters" : {
                    "CreationDateBottom" : "01.01.2019"
                }
            }

        ],      
        
        "Downloading a report for the full previous month (~50k rows)" : [

            {
                "name": "Transaction Management → Transactions",
                "url": "https://testing1.kontocloud.com:8443/kontocloud/backoffice/Transaction/List",
                "parameters": {
                    "CreationDateBottom" : "01.06.2018 00:00:00",
                    "CreationDateTop" : "01.06.2018 23:59:59",
                    "~~download": ""
                }
            },
            {
                "name": "Transaction Management → External Transactions",
                "url": "https://testing1.kontocloud.com:8443/kontocloud/backoffice/TransactionAcquiring/List",
                "parameters": {
                    "CreationDateBottom" : "01.06.2018 00:00:00",
                    "CreationDateTop" : "02.06.2018 14:00:00",
                    "~~download": ""
                }
            },
            {
                "name": "Transaction Management → Internal Transactions",
                "url": "https://testing1.kontocloud.com:8443/kontocloud/backoffice/TransactionIssuing/List",
                "parameters": {
                    "CreationDateBottom" : "01.06.2018 00:00:00",
                    "CreationDateTop" : "02.06.2018 08:30:00",
                    "~~download": ""
                }
            },
            {
                "name": "Transaction Management → Scheduled Transactions",
                "url": "https://testing1.kontocloud.com:8443/kontocloud/backoffice/ScheduledTransaction/List",
                "parameters" : {
                    "CreationDateFrom" : "01.01.2018 00:00:00",
                    "CreationDateTo" : "01.01.2019 00:00:00",
                    "~~download": ""
                }
            },
            {
                "name": "Transaction Management → Unsettled Transactions",
                "url": "https://testing1.kontocloud.com:8443/kontocloud/backoffice/UnsettledTransaction/List",
                "parameters" : {
                    "CreationDateBottom" : "01.06.2018",
                    "CreationDateTop" : "05.06.2018",
                    "~~download": ""
                }
            }

        ],

        "Downloading a report for the period from the first day of the last month to today's date (~950k rows)": [

            {
                "name": "Transaction Management → Transactions",
                "url": "https://testing1.kontocloud.com:8443/kontocloud/backoffice/Transaction/List",
                "parameters": {
                    "CreationDateBottom" : "01.06.2018 00:00:00",
                    "CreationDateTop" : "28.06.2018 18:00:00",
                    "~~download": ""
                }
            },
            {
                "name": "Transaction Management → External Transactions",
                "url": "https://testing1.kontocloud.com:8443/kontocloud/backoffice/TransactionAcquiring/List",
                "parameters": {
                    "CreationDateBottom" : "01.06.2018 00:00:00",
                    "CreationDateTop" : "30.06.2018 07:30:00",
                    "~~download": ""
                }
            },
            {
                "name": "Transaction Management → Internal Transactions",
                "url": "https://testing1.kontocloud.com:8443/kontocloud/backoffice/TransactionIssuing/List",
                "parameters": {
                    "CreationDateBottom" : "01.06.2018 00:00:00",
                    "CreationDateTop" : "29.06.2018 14:30:00",
                    "~~download": ""
                }
            },
            {
                "name": "Transaction Management → Scheduled Transactions",
                "url": "https://testing1.kontocloud.com:8443/kontocloud/backoffice/ScheduledTransaction/List",
                "parameters" : {
                    "CreationDateFrom" : "01.01.2018 00:00:00",
                    "CreationDateTo" : "01.01.2019 00:00:00",
                    "~~download": ""
                }
            },
            {
                "name": "Transaction Management → Unsettled Transactions",
                "url": "https://testing1.kontocloud.com:8443/kontocloud/backoffice/UnsettledTransaction/List",
                "parameters" : {
                    "CreationDateBottom" : "01.06.2018",
                    "CreationDateTop" : "01.01.2019",
                    "~~download": ""
                }
            }
        ]
        
        
*/
