// var test = require("./puppeteerDriver");
const performanceTester = require('./performanceTester');
const puppeteer = require('puppeteer');
const fs = require('fs');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const colors = require('colors');


(async () => {

    try{
        let startTimestamp =  Date.now();


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
            console.log("Test complect: ".blue, testComplectName.blue.bold)

            let tests = testsParams[test];
            for(let i = 0; i < tests.length; i++){
                
                try{
                    process.stdout.write('Test started: \'' + tests[i].name + '\'');

                    let testParams = tests[i].parameters ? tests[i].parameters : {};
                    let measuredData = await performanceTester.newTest(page, tests[i].url, testParams);
        
                    let fields = ['htmlTime', 'listReadCollectTime', 'listReadCounterTime'];
                    
                    if(testParams.hasOwnProperty('~~download')) {
                        fields.push('downloadTime');
                    }
                    // console.log(fields);
                    let extractedData = extractNecessaryData(measuredData.timeMeasurementData, fields);

                    let newReportRow = {
                        'name': tests[i].name,
                        'url': tests[i].url,
                        'averageTime': measuredData.averageTime,
                        'htmlTime': extractedData.htmlTime,
                        'listReadCollectTime': extractedData.listReadCollectTime,
                        'listReadCounterTime': extractedData.listReadCounterTime,
                        'downloadTime' : extractedData.downloadTime ? extractedData.downloadTime : undefined
                    }
        
                    rowData.push(measuredData.timeMeasurementData);
                    dataReport.push(newReportRow);
        
                    process.stdout.write('\033[0GTEST PASSED: \n'.bgGreen.black);

                }catch(e){
                    
                    process.stdout.write('\033[0GTEST FAILED: \n'.bgRed.black);
                    console.log('Exception: ');
                    console.error(e);

                }

            }
        }
        // tests executed /////////////////////////////////////


        // saving reoirts /////////////////////////////////////
        let finishTimestamp = new Date();
        if (executionParams.rowReportPath !== undefined || executionParams.rowReportPath !== ""){
            saveDataToJSON(rowData, executionParams.rowReportPath, 'row_test_report_' + finishTimestamp.getTime() + '.json');
        }
    
        saveDataToCsv(dataReport, executionParams.reportPath,'test_report_' + finishTimestamp.getTime() + '.csv');
        ///////////////////////////////////////////////////////


            // don't close the browser to compare real timings with measured
        await page.close();
        await browser.close();


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

function extractNecessaryData(data, fields){

    const mainUrl = data.mainUrl;

    let extractedData = {
        'htmlTime' : -1,
        'listReadCollectTime': -1,
        'listReadCounterTime': -1,
        'downloadTime': undefined,
    };

    for(let key in data.requestsData){
        let row = data.requestsData[key];

            // HTML Document 
        if(row.resourceType === 'Document' && row.method === 'GET' && row.url === (mainUrl + '/List'))
            extractedData.htmlTime = row.responseTime;

            // Document Load
        if(row.method === 'POST' && (row.url === (mainUrl + '/ExportToExcel') || row.url === (mainUrl + '/Download'))){
            if(fields.includes('downloadTime')){
                extractedData.downloadTime = (row.responseTime / 1000).toFixed(2); // convert to seconds
            }
        }

        if(row.url === (mainUrl + '/List_Read') && row.method === 'POST')
            {   // List_Read
                let parsedPostData = row.postData.split('&');
                for(let i = 0; i < parsedPostData.length; i++){
                    parsedPostData[i] = parsedPostData[i].split('=')[0];    // parsedPostData contains only parameter names
                }

                if(parsedPostData.includes('pageSize')){
                    extractedData.listReadCollectTime = row.responseTime;
                }
                if(parsedPostData.includes('aggregate')){
                    extractedData.listReadCounterTime = row.responseTime;
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
            {id: "listReadCollectTime", title: "List_Read collect load time (ms)"},
            {id: "listReadCounterTime", title: "List_Read counter load time (ms)"},
            {id: "downloadTime", title: "Report download time (s)"}
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


/* ,

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
                    "CreationDateBottom" : "01.01.2019 00:00:00",
                    "CreationDateTop" : "31.01.2019 23:59:59"
                }
            },
            {
                "name": "Transaction Management → External Transactions",
                "url": "https://testing1.kontocloud.com:8443/kontocloud/backoffice/TransactionAcquiring/List",
                "parameters": {
                    "CreationDateBottom" : "01.01.2019 00:00:00",
                    "CreationDateTop" : "31.01.2019 23:59:59"
                }
            },
            {
                "name": "Transaction Management → Internal Transactions",
                "url": "https://testing1.kontocloud.com:8443/kontocloud/backoffice/TransactionIssuing/List",
                "parameters": {
                    "CreationDateBottom" : "01.01.2019 00:00:00",
                    "CreationDateTop" : "31.01.2019 23:59:59"
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
                    "CreationDateBottom" : "01.01.2019",
                    "CreationDateTop" : "31.01.2019"
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
        
        "Downloading a report for the full previous month" : [

            {
                "name": "Transaction Management → Transactions",
                "url": "https://testing1.kontocloud.com:8443/kontocloud/backoffice/Transaction/List",
                "parameters": {
                    "CreationDateBottom" : "01.01.2019 00:00:00",
                    "CreationDateTop" : "31.01.2019 23:59:59",
                    "~~download": ""
                }
            },
            {
                "name": "Transaction Management → External Transactions",
                "url": "https://testing1.kontocloud.com:8443/kontocloud/backoffice/TransactionAcquiring/List",
                "parameters": {
                    "CreationDateBottom" : "01.01.2019 00:00:00",
                    "CreationDateTop" : "31.01.2019 23:59:59",
                    "~~download": ""
                }
            },
            {
                "name": "Transaction Management → Internal Transactions",
                "url": "https://testing1.kontocloud.com:8443/kontocloud/backoffice/TransactionIssuing/List",
                "parameters": {
                    "CreationDateBottom" : "01.01.2019 00:00:00",
                    "CreationDateTop" : "31.01.2019 23:59:59",
                    "~~download": ""
                }
            },
            {
                "name": "Transaction Management → Scheduled Transactions",
                "url": "https://testing1.kontocloud.com:8443/kontocloud/backoffice/ScheduledTransaction/List",
                "parameters" : {
                    "CreationDateFrom" : "01.06.2018 00:00:00",
                    "CreationDateTo" : "30.06.2018 23:59:59",
                    "~~download": ""
                }
            },
            {
                "name": "Transaction Management → Unsettled Transactions",
                "url": "https://testing1.kontocloud.com:8443/kontocloud/backoffice/UnsettledTransaction/List",
                "parameters" : {
                    "CreationDateBottom" : "01.01.2019",
                    "CreationDateTop" : "31.01.2019",
                    "~~download": ""
                }
            }

        ],

        "Downloading a report for the period from the first day of the last month to today's date": [

            {
                "name": "Transaction Management → Transactions",
                "url": "https://testing1.kontocloud.com:8443/kontocloud/backoffice/Transaction/List",
                "parameters": {
                    "CreationDateBottom" : "01.01.2019 00:00:00",
                    "~~download": ""
                }
            },
            {
                "name": "Transaction Management → External Transactions",
                "url": "https://testing1.kontocloud.com:8443/kontocloud/backoffice/TransactionAcquiring/List",
                "parameters": {
                    "CreationDateBottom" : "01.01.2019 00:00:00",
                    "~~download": ""
                }
            },
            {
                "name": "Transaction Management → Internal Transactions",
                "url": "https://testing1.kontocloud.com:8443/kontocloud/backoffice/TransactionIssuing/List",
                "parameters": {
                    "CreationDateBottom" : "01.01.2019 00:00:00",
                    "~~download": ""
                }
            },
            {
                "name": "Transaction Management → Scheduled Transactions",
                "url": "https://testing1.kontocloud.com:8443/kontocloud/backoffice/ScheduledTransaction/List",
                "parameters" : {
                    "CreationDateFrom" : "01.06.2018 00:00:00",
                    "~~download": ""
                }
            },
            {
                "name": "Transaction Management → Unsettled Transactions",
                "url": "https://testing1.kontocloud.com:8443/kontocloud/backoffice/UnsettledTransaction/List",
                "parameters" : {
                    "CreationDateBottom" : "01.01.2019",
                    "~~download": ""
                }
            }
        ]
        
*/