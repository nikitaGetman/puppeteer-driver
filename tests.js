// var testSuiteName = require("./puppeteerDriver");
const performanceTester = require('./performanceTester');
const puppeteer = require('puppeteer');
const fs = require('fs');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const colors = require('colors');
const {TimeoutError} = require('puppeteer/Errors');


(async () => {

    try{
        let startTimestamp =  Date.now();


            // loading configuration and log into the system
        let file = process.argv[2];
        console.log("Starting..");
        console.log("Opening file: " + file);
        let cfg = await performanceTester.loadConfig(file);
        
        let loginParams = cfg.loginParameters;
        let executionParams = cfg.executionParameters;
        let testsParams = cfg.tests;
        let blacklist = cfg.blacklist ? cfg.blacklist : [];

        
        //////////////////////////////////////////////////


        // tests execution ///////////////////////////////
        let rowData = [];
        let dataReport = [];
        let timeoutedTests = [];

        for(let testSuiteName in testsParams){

            // let resp = await performanceTester.init(executionParams, loginParams);
            let browser = {};
            let page = {};


            dataReport.push({'url' : testSuiteName});
            console.log("Test suite: ".blue, testSuiteName.blue.bold)

            let tests = testsParams[testSuiteName];
            for(let i = 0; i < tests.length; i++){

                let resp = await performanceTester.init(executionParams, loginParams);
                browser = resp.browser;
                page = resp.page;
                
                try{

                    process.stdout.write('Test started: \'' + tests[i].name + '\'');

                    let testParams = tests[i].parameters ? tests[i].parameters : {};
                    let measuredData = await performanceTester.newTest(page, tests[i].url, testParams);
        
                    let extractedData = extractNecessaryData(measuredData.timeMeasurementData, blacklist);



                    rowData.push(measuredData.timeMeasurementData);

                    dataReport.push({'url': tests[i].name, 'time': measuredData.averageTime});
                    for(req in extractedData){
                        dataReport.push({
                            'url': extractedData[req].url,
                            'time': extractedData[req].responseTime,
                            'method': extractedData[req].method
                        });
                    }

                    process.stdout.write('\033[0GTEST PASSED: '.bgGreen.black);
                    console.log();

                    // don't close the browser to compare real timings with measured

                }catch(e){
                    
                    process.stdout.write('\033[0GTEST FAILED: '.bgRed.black);
                    console.log();
                    console.log('Exception: ');
                    console.error(e);

                    if(e instanceof TimeoutError){
                        timeoutedTests.push({testSuiteName : tests[i]});
                    }

                }

                    // close browser after each test
                await page.close();
                // await browser.close();
                await setTimeout(()=>{
                    browser.close();
                }, 1000);

            }

            

        }
        // tests executed /////////////////////////////////////

        // trying to re-process timeouted tests ///////////////
        if(timeoutedTests.length > 0){
            dataReport.push({'url' : 'Timeouted tests'});
            console.log("Test suite: ".blue, 'Timeouted tests'.blue.bold)
        }
        for(let i=0; i < timeoutedTests.length; i++){

            for(testSuiteName in timeoutedTests[i]){

                let resp = await performanceTester.init(executionParams, loginParams);
                let browser = resp.browser;
                let page = resp.page;

                try{

                    process.stdout.write('Test started: \'' + timeoutedTests[i][testSuiteName].name + '\'');

                    let testParams = timeoutedTests[i][testSuiteName].parameters ? timeoutedTests[i][testSuiteName].parameters : [];
                    let measuredData = await performanceTester.newTest(page, timeoutedTests[i][testSuiteName].url, testParams);
        
                    let extractedData = extractNecessaryData(measuredData.timeMeasurementData, blacklist);


                    dataReport.push({'url': timeoutedTests[i][testSuiteName].name, 'time': measuredData.averageTime});
                    for(req in extractedData){
                        dataReport.push({
                            'url': extractedData[req].url,
                            'time': extractedData[req].responseTime,
                            'method': extractedData[req].method
                        });
                    }

                    process.stdout.write('\033[0GTEST PASSED: '.bgGreen.black);
                    console.log();

                }catch(e){
                    
                    process.stdout.write('\033[0GTEST FAILED: '.bgRed.black);
                    console.log();
                    console.log('Exception: ');
                    console.error(e);

                }

                    // close browser after each test
                await page.close();
                // await browser.close();
                await setTimeout(()=>{
                    browser.close();
                }, 1000);
                
            }
        }
        ///////////////////////////////////////////////////////

        // saving reports /////////////////////////////////////
        let finishTimestamp = new Date();
        if (executionParams.rowReportPath !== undefined || executionParams.rowReportPath !== ""){
        //    await saveDataToJSON(rowData, executionParams.rowReportPath, 'row_test_report_' + finishTimestamp.getTime() + '.json');
        }
    
        await saveDataToCsv(dataReport, executionParams.reportPath,'test_report_' + finishTimestamp.getTime() + '.csv');
        ///////////////////////////////////////////////////////


            // print elapsed time
        let elapsedTimestamp = new Date(finishTimestamp - startTimestamp);
        let hours = '0' + (elapsedTimestamp.getUTCHours());
        let minutes = '0' + elapsedTimestamp.getUTCMinutes();
        let seconds = '0' + elapsedTimestamp.getUTCSeconds();

        let elapsedTime = hours.slice(-2) + ':' + minutes.slice(-2) + ':' + seconds.slice(-2);
        console.log('Elapsed time: ', elapsedTime);
    }
    catch(e){

        console.error('Something went wrong during execution:');
        console.error(e);

    }
    
})();

function extractNecessaryData(data, blacklist){

    let extractedData = [];

    for(let key in data.requestsData){
        let row = data.requestsData[key];

            // if resourceType in blackList
        if(row.resourceType === 'Stylesheet' || row.resourceType === 'Script' || row.resourceType === 'Image' || row.resourceType === 'Font')
            continue;

            // if url in blacklist
        if(blacklist.includes(row.url))
            continue;


        extractedData.push({'url': row.url, 'responseTime': row.responseTime, 'resourceType': row.resourceType, 'method': row.method, 'postData': row.postData});

    }
    
    return extractedData;
};

async function saveDataToCsv(data, path, filename){
    
    if(!fs.existsSync(path)){
        fs.mkdirSync(path);
    }

    let fullPath = path.slice(-1) === '/' ? path + filename : path + '/' + filename;

    const csvWriter = createCsvWriter({
        path: fullPath,
        header: [
            {id: 'url', title: 'Url'},
            {id: 'time', title: 'Elapsed time (ms)'},
            {id: 'method', title: 'Method'}
        ]
    });

    await csvWriter.writeRecords(data)
        .then((ok) => {
            console.log('Report saved to: ', filename);
        }, (err) => {
            throw err;
        });
};

async function saveDataToJSON(data, path, filename){
    
    if(!fs.existsSync(path)){
        fs.mkdirSync(path);
    }

    let fullPath = path.slice(-1) === '/' ? path + filename : path + '/' + filename;

    await fs.writeFile(fullPath, JSON.stringify(data), (err) => {
        if (err) throw err;
    });
}


/*
    TODOs:
        1 - Move "email templates -> new", "contents -> new" and "bank holidays" to "CUD"
*/