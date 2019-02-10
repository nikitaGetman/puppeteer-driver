const puppeteer = require('puppeteer');


exports.test = class TestEnvironment{
  constructor(params){
    // console.log('constructor');

    return (async () => {

      this.browser = await puppeteer.launch(params);

      console.log('Hello, browser is launched..');

      return this;
    })();
  }
  async createPage(url){
    // console.log('page created');
    return await this.browser.newPage(url);
  }

  async newTest(testName, url, ){
    let page = await this.createPage(url);
    let test = new Test(testName, page);
    
    return test;
  }

  async closeEnvironment(){
    await this.browser.close();
  }
};

class Test{
  constructor(testName, page){
    this.testName = testName;
    this.page = page;
  }
}