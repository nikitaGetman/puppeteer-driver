## Before before start:
1. Make sure you have node.js installed;
2. Execute `npm i` and make sure that all packages dowloaded correctly.

## Before start:
1. Specify correct user settings in `loginParameters` and `executionParameters`;
2. Backup databese;
3. Create Transactions for Chargeback and Reject pages;
4. Create user with active 'Send Verification link' button.

## Start:
1. Execute `tests.js "tests_5.7/{fileName}"`

## Tips:
1. Divide your tests on small parts and execute it one by one (becouse report generates at the end of execution, so if program will crash you will loose all progress for last couple of hours) 

## Commands:
1. ~~download - clicks "Download" button (better use ~~click + selector)
2. ~~focus + CSS selector
3. ~~press + button
4. ~~click + CSS selector
5. ~~delay + time in ms
6. ~~goto + URL
7. ~~refresh - reloads current page
8. ~~resetFilters - click "Reset Filters" button

Also you can write something like:
"{CSS selector}": "{text to type in this field}"
e.g. {"#BookingDateTop": "22.02.2019"}

## Syntax of tests:
```javascript
....
"tests" : {
  
  "{any name of test suite}" : [
      {
        "name": "{test name}",
        "url": "{url}",
        "parameters": [  - optionally
          { "{name of command}": "{arguments}" },
          ...
        ]
      }
  ]

}
....
```
