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

        // TODO: check that required parameters are specified
    }
    catch(e){
        console.error(e);
    }
    
    // console.log(config);

    return config;
};

/*
    init - creates browser and page. And logging via specified in configuration file parameters
        Returns page object
        {
            params - parameters for puppeteer.launch()
            loginParams - parameters specified in configuration file, necessary for correct logging in system
        }
*/
exports.init = async function init(params, loginParams){

    const browser = await puppeteer.launch(params);
    const page = await browser.newPage();
    await page.setDefaultNavigationTimeout(240000); // 4 minutes
    await page.setDefaultTimeout(240000); // 4 minutes

    browser.on('targetchanged', () => {
        page.bringToFront();
    });

        // TODO: add listeners for: close, console, dialog, error, pageerror
    page.on('requestfailed', request => {
            // emits when reloading page with filters without waiting
        //console.log('Request failed: ' + request.url() + ' (METHOD: ' + request.method() + ', postData: ' + request.postData() + ') - ' + request.failure().errorText);
    });
    

    //// login ////
    try{
        await page.goto(loginParams.loginUrl);

        await page.type('#UserLogin', loginParams.username);
        await page.type('#Password', loginParams.password);
        await page.click('input[type="submit"]');
        await page.waitForNavigation({waitUntil: ['load']});
        
            
    }catch(e){
        // TODO: log to file
        console.log(e);
    }

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
    
    await page.setCacheEnabled(true);
    await page.goto(url, {waitUntil: 'networkidle0'});


        // TODO potentional issue 
    let mainUrl = '';
    if(url.slice(-5) === '/List') mainUrl = url.slice(0, -5);
    else mainUrl = url;
        ////////////////// 
    let commands = {};
        
    // if parameters specified then trying to apply it to filters
    if(! isEmpty(testParams)){
        // console.log('Parameters for test:');
        // console.log(testParams);

        try{
            
            await page.click('.filter-actions > button[type="button"]:last-child'); // Reset Filters button

            for(param in testParams){
                if(param.slice(0, 2) === '~~'){  // if it's command
                    commands[param] = testParams[param];
                    continue;   
                }
                await page.type('#' + param, new String(testParams[param]));
            }
            
            await page.click('.filter-actions > button[type="button"]:first-child'); // Refresh button

        }catch(e){
            console.error(e);
        }
    }

    
    let requestsData = {};

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

        requestsData[key] = newRequest;

        if(firstRequestTime === -1){
            firstRequestTime = request['timestamp'];
        }
    });
    client.on('Network.responseReceived', (response) => {

        try{
            let key = response['requestId'];
            requestsData[key]['responseTimestamp'] = response['timestamp'];

            let responseTime = (response['response']['timing']['receiveHeadersEnd'] - response['response']['timing']['sendEnd']);
            requestsData[key]['responseTime'] = responseTime > 0 ? responseTime : 0;

            // console.log(response['response']['timing']);
        }catch(e){
            // TODO: log error
        }

    });
    client.on('Network.loadingFinished', (request) => {
        
        try{
            let key = request['requestId'];
            requestsData[key]['downloadTimestamp'] = request['timestamp'];

            let downloadTime = request['timestamp'] - requestsData[key]['responseTimestamp'];
            requestsData[key]['downloadTime'] += downloadTime > 0 ? downloadTime : 0;

            lastResponseTime = request['timestamp'];
        }catch(e){

        }

    });
    client.on('Network.loadingFailed', (request) => {
        try{
            let key = request['requestId'];
            delete requestsData[key];
        }catch(e){
            console.error(e);
        }
    });



    /// General cycle of time measurement
    let averageTime = 0;
    const iterations = 1;   


    for(let i=0; i < iterations; i++){

        firstRequestTime = -1;
        lastResponseTime = -1;
        
        await page.reload({waitUntil: 'networkidle0'});

        averageTime += (lastResponseTime - firstRequestTime);

        try{
            for(cmd in commands){
                if(cmd === '~~download'){
                    await page.setDefaultTimeout(2400000); // 40 minutes for downloading reports

                    await page.click('.form-group > div > div[data-apply-filter] > .k-button');
                    console.log('Waiting for download...');
                    await page.waitForResponse(response => {
                        let isOk = response.url() === mainUrl + '/ExportToExcel' || response.url() === mainUrl + '/Download'
                        return isOk;
                    });
                    await page.waitFor(1000);

                    await page.setDefaultTimeout(240000); // returns to 4 minutes
                }
            }
        }catch(e){
            console.error('Error while processing command for: ', url);
            console.log(e);
        }
        
    }


    // Getting average values

    for(let req in requestsData){
        requestsData[req]['responseTime'] = Math.round(requestsData[req]['responseTime'] / iterations * 100) / 100;
        requestsData[req]['downloadTime'] = Math.round(requestsData[req]['downloadTime'] * 100000 / iterations) / 100;
    }
    averageTime = (averageTime / iterations).toFixed(2);
    
    // console.log(requestsData);

    client.send('Network.disable');



    return {averageTime, 'timeMeasurementData': {'mainUrl': mainUrl, requestsData} };
};