// var test = require("./puppeteerDriver");
const performanceTester = require('./performanceTester');
const puppeteer = require('puppeteer');
const fs = require('fs');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;


(async () => {

    try{
            // loading configuration and login in the system
        let cfg = await performanceTester.loadConfig('config.json');
        
        let loginParams = cfg.loginParameters;
        let executionParams = cfg.executionParameters;
        let testsParams = cfg.tests;

        let {browser, page} = await performanceTester.init(executionParams, loginParams);
            //////////////////////////////////////////////////


            // tests execution ///////////////////////////////
        let rowData = [];
        let dataReport = [];

        for(test in testsParams){
            let testComplectName = test;

            dataReport.push({'name' : testComplectName});

            let tests = testsParams[test];
            for(let i = 0; i < tests.length; i++){
                
                try{
                    console.log('Test started: \'' + testComplectName + ': ' + tests[i].name + '\'');

                    let testParams = {}; // TODO parameters (filter values)
                    let measuredData = await performanceTester.newTest(page, tests[i].url, testParams);
        
                    let extractedData = extractNecessaryData(measuredData.timeMeasurementData);
        
                    let newReportRow = {
                        'name': tests[i].name,
                        'url': tests[i].url,
                        'averageTime': measuredData.averageTime,
                        'htmlTime': extractedData.htmlTime,
                        'listReadCollectTimer': extractedData.listReadCollectTimer,
                        'listReadCounterTimer': extractedData.listReadCounterTimer
                    }
        
                    rowData.push(measuredData.timeMeasurementData);
                    dataReport.push(newReportRow);
        
                    console.log('Test passed: \'' + testComplectName + ': ' + tests[i].name + '\'');

                }catch(e){

                    console.error('Test failed: \'' + testComplectName + ': ' + tests[i].name + '\'');
                    console.error(e);

                }

            }
        }
        // tests executed /////////////////////////////////////

        // saving reoirts /////////////////////////////////////
        if (executionParams.rowReportPath !== undefined || executionParams.rowReportPath !== ""){
            saveDataToJSON(rowData, executionParams.rowReportPath, 'row_test_report_' + Date.now() + '.json');
        }
    
        saveDataToCsv(dataReport, executionParams.reportPath,'test_report_' + Date.now() + '.csv');
        ///////////////////////////////////////////////////////

            // don't close the browser to compare real timings with measured
        // await browser.close();

    }
    catch(e){

        console.error('Something went wrong during execution:');
        console.error(e);

    }
    
})();

function extractNecessaryData(data){

    const mainUrl = data.mainUrl;

    let extractedData = {
        'htmlTime' : -1,
        'listReadCollectTimer': -1,
        'listReadCounterTimer': -1
    };

    for(let key in data.requestsData){
        let row = data.requestsData[key];

            // HTML Document 
        if(row.resourceType === 'Document' && row.method === 'GET' && row.url === (mainUrl + '/List'))
            extractedData.htmlTime = row.responseTime;


        if(row.url === (mainUrl + '/List_Read') && row.method === 'POST')
            {   // List_Read
                let parsedPostData = row.postData.split('&');
                for(let i = 0; i < parsedPostData.length; i++){
                    parsedPostData[i] = parsedPostData[i].split('=')[0];    // parsedPostData contains only parameter names
                }

                if(parsedPostData.includes('pageSize')){
                    extractedData.listReadCollectTimer = row.responseTime;
                }
                if(parsedPostData.includes('aggregate')){
                    extractedData.listReadCounterTimer = row.responseTime;
                }
            }
    }
    
    for(key in extractedData){
        if(extractedData[key] === -1){
            throw ('Something went wrong while extracting data from: ' + mainUrl);
        }
    }


    return extractedData;
};

function saveDataToCsv(data, path, filename){
    
    if(!fs.existsSync(path)){
        fs.mkdirSync(path);
    }

    let fullPath = path.slice(-1) === '/' ? path + filename : path + '/' + filename;

    const csvWriter = createCsvWriter({
        path: fullPath,
        header: [
            {id: "name", title: "Test name"},
            {id: "url", title: "Url"},
            {id: "averageTime", title: "Page load time (s)"},
            {id: "htmlTime", title: "HTML Document load time (ms)"},
            {id: "listReadCollectTimer", title: "List_Read collect load time (ms)"},
            {id: "listReadCounterTimer", title: "List_Read counter load time (ms)"}
        ]
    });

    csvWriter.writeRecords(data)
        .then((ok) => {
            console.log('Report saved to: ', filename);
        }, (err) => {
            throw err;
        });
};

function saveDataToJSON(data, path, filename){
    
    if(!fs.existsSync(path)){
        fs.mkdirSync(path);
    }

    let fullPath = path.slice(-1) === '/' ? path + filename : path + '/' + filename;

    fs.writeFile(fullPath, JSON.stringify(data), (err) => {
        if (err) throw err;
    });
}