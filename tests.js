// const test = require('puppeteerDriver');
var driver = require("./puppeteerDriver");
// const puppeteer = require('puppeteer');
//let t = new driver.test;

( async () => {
    var t =  await new driver.test();
    await t.newTest('timePerformance', 'http://google.com');

    await t.closeEnvironment();
})();


// (async () => {
//     const browser = await puppeteer.launch({'headless': false});
//     const page = await browser.newPage();

//     // let metricsTimestams = 0;
//     // let loadedTimestamp = 0;
//     // let finishTimestamp = 0;
//     // let idle0Timestamp = 0;
//     // let idle2Timestamp = 0;
//     let startTime = Date.now();
   
//     page.on('domcontentloaded', () => { console.log("domcontentloaded time: ", Date.now() - startTime); })
//     page.on('metrics', () => { console.log("metrics time: ", Date.now() - startTime); });
//     page.on('load', () => { console.log("load time: ", Date.now() - startTime); })
//     page.goto('https://auto.ru');
//     await page.screenshot({path: 'example.png'});
//     let m = await page.metrics();
//     console.log(m);

//     startTime = Date.now();    
//     await page.reload({'waitUntil' : ['networkidle0']});
//     console.log("idle0 time: ", Date.now() - startTime);
//     m = await page.metrics();
//     console.log(m);

//     startTime = Date.now();
//     await page.reload({'waitUntil' : ['networkidle2']});
//     console.log("idle2 time: ", Date.now() - startTime);
//     m = await page.metrics();
//     console.log(m);
   
    
    

//     await browser.close();
// })();

