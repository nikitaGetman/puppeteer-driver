// const driver = require('./puppeteerDriver');
const puppeteer = require('puppeteer');
const fs = require('fs');


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

    browser.on('targetchanged', () => {
        page.bringToFront();
    });

        // TODO: add listeners for: close, console, dialog, error, pageerror
    page.on('requestfailed', request => {
            // TODO: log to file
        console.log('Request failed: ' + request.url() + ' (METHOD: ' + request.method() + ', postData: ' + request.postData() + ') - ' + request.failure().errorText);
    });
    

    //// login ////
    try{
        await page.goto(loginParams.loginUrl);
            //TODO: process.env
        await page.type('#UserLogin', loginParams.username);
        await page.type('#Password', loginParams.password);
        await page.click('input[type="submit"]');
        await page.waitForNavigation({waitUntil: ['networkidle0']});
       
    }catch(e){
        // TODO: log to file
        console.error(e);
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

        let key = response['requestId'];
        requestsData[key]['responseTimestamp'] = response['timestamp'];

        let responseTime = response['timestamp'] - requestsData[key]['startTimestamp'];
        requestsData[key]['responseTime'] += responseTime > 0 ? responseTime : 0;

        // requestsData[key]['responseTimestamp'] = Date.now() / 1000.0;
        // requestsData[key]['responseTime'] = requestsData[key]['responseTimestamp'] - requestsData[key]['startTimestamp'];
    });
    client.on('Network.loadingFinished', (request) => {

        let key = request['requestId'];
        requestsData[key]['downloadTimestamp'] = request['timestamp'];

        let downloadTime = request['timestamp'] - requestsData[key]['responseTimestamp'];
        requestsData[key]['downloadTime'] += downloadTime > 0 ? downloadTime : 0;

        // requestsData[key]['downloadTimestamp'] = Date.now() / 1000.0;
        // requestsData[key]['downloadTime'] = requestsData[key]['downloadTimestamp'] - requestsData[key]['responseTimestamp'];

        lastResponseTime = request['timestamp'];
    });



    /// General cycle of time measurement
    let averageTime = 0;
    const iterations = 1;   


    for(let i=0; i < iterations; i++){

        firstRequestTime = -1;
        lastResponseTime = -1;
        
        await page.reload({waitUntil: 'networkidle0'});
        
        // console.log('Elapsed time: ', (lastResponseTime - firstRequestTime).toFixed(2));

        averageTime += (lastResponseTime - firstRequestTime);
    }


    // Getting average values

    for(let req in requestsData){
        requestsData[req]['responseTime'] = (requestsData[req]['responseTime'] * 1000 / iterations).toFixed(2);
        requestsData[req]['downloadTime'] = (requestsData[req]['downloadTime'] * 1000 / iterations).toFixed(2);
    }
    averageTime = (averageTime / iterations).toFixed(2);
    
    // console.log(requestsData);

    client.send('Network.disable');


        // TODO potentional issue (applicable only for List_Read)
    let mainUrl = '';
    if(url.slice(-5) === '/List') mainUrl = url.slice(0, -5);
    else mainUrl = url;
        ////////////////// 
    return {averageTime, 'timeMeasurementData': {'mainUrl': mainUrl, requestsData} };
};