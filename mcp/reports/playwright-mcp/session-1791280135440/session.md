
### Tool call: browser_navigate
- Args
```json
{
  "url": "https://u-byufuel.azurewebsites.net/sign-in"
}
```
- Result
```json
{
  "code": "await page.goto('https://u-byufuel.azurewebsites.net/sign-in');",
  "page": "- Page URL: https://u-byufuel.azurewebsites.net/\n- Page Title: BYUFUEL | Centvis\n- Console: 1 errors, 0 warnings",
  "snapshot": "",
  "events": "- New console entries: d:\\Travel VIP API Automation\\reports\\playwright-mcp\\console-2026-10-06T09-48-55-481Z.log#L1-L12"
}
```

### Tool call: browser_snapshot
- Args
```json
{}
```
- Result
```json
{
  "page": "- Page URL: https://u-byufuel.azurewebsites.net/\n- Page Title: BYUFUEL | Centvis\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": ""
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "filename": "reports/byufuel-tsm-web-home.png",
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of viewport](reports\\byufuel-tsm-web-home.png)",
  "code": "// Screenshot viewport and save it as reports\\byufuel-tsm-web-home.png\nawait page.screenshot({\n  path: 'reports\\\\byufuel-tsm-web-home.png',\n  scale: 'css',\n  type: 'png'\n});"
}
```

### Tool call: browser_navigate
- Args
```json
{
  "url": "https://u-byufuel.azurewebsites.net/auth/login"
}
```
- Result
```json
{
  "code": "await page.goto('https://u-byufuel.azurewebsites.net/auth/login');",
  "page": "- Page URL: https://u-byufuel.azurewebsites.net/auth/login\n- Page Title: Login | BYUFUEL",
  "snapshot": "",
  "events": "- New console entries: d:\\Travel VIP API Automation\\reports\\playwright-mcp\\console-2026-10-06T09-50-07-106Z.log#L1"
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "depth": 6
}
```
- Result
```json
{
  "page": "- Page URL: https://u-byufuel.azurewebsites.net/auth/login\n- Page Title: Login | BYUFUEL",
  "inlineSnapshot": "- generic [ref=f2e5]:\n  - generic [ref=f2e14]:\n    - heading \"Login\" [level=1] [ref=f2e16]\n    - generic [ref=f2e20]:\n      - generic [ref=f2e21]:\n        - text: Email\n        - generic [aria-hidden] [ref=f2e22]: \"*\"\n      - textbox \"Email\" [ref=f2e23]\n    - generic [ref=f2e26]:\n      - generic [ref=f2e27]:\n        - generic [ref=f2e28]:\n          - text: Password\n          - generic [aria-hidden] [ref=f2e29]: \"*\"\n        - textbox \"Password\" [ref=f2e30]\n      - button [ref=f2e32] [cursor=pointer]\n    - link \"Forgot password\" [ref=f2e40] [cursor=pointer]:\n      - /url: /auth/forgot-password\n    - button \"Login\" [ref=f2e43] [cursor=pointer]\n  - contentinfo [ref=f2e50]:\n    - generic [ref=f2e51]: Copyright © 2026 Byufuel India Pvt. Ltd.\n    - generic [ref=f2e52]: Version 1.0.0 (20260922.1)\n    - generic [ref=f2e53]:\n      - generic [ref=f2e54] [cursor=pointer]: Privacy Policy\n      - generic [ref=f2e55] [cursor=pointer]: Terms",
  "events": "- New console entries: d:\\Travel VIP API Automation\\reports\\playwright-mcp\\console-2026-10-06T09-50-07-106Z.log#L2"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "f2e23",
      "name": "Email",
      "type": "textbox",
      "value": "rohan.tsm.byufuel@yopmail.com"
    },
    {
      "target": "f2e30",
      "name": "Password",
      "type": "textbox",
      "value": "R7m#Byuf"
    }
  ]
}
```
- Result
```json
{
  "code": "await page.getByRole('textbox', { name: 'Email' }).fill('rohan.tsm.byufuel@yopmail.com');\nawait page.getByRole('textbox', { name: 'Password' }).fill('R7m#Byuf');"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Login button",
  "target": "f2e43"
}
```
- Result
```json
{
  "code": "await page.getByRole('button', { name: 'Login' }).click();",
  "page": "- Page URL: https://u-byufuel.azurewebsites.net/auth/login\n- Page Title: Login | BYUFUEL\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=f2e5]:\n  - generic [ref=f2e14]:\n    - heading \"Login\" [level=1] [ref=f2e16]\n    - generic [ref=f2e57]:\n      - generic [ref=f2e61]: Please login using Mobile App\n      - button [ref=f2e63] [cursor=pointer]\n    - generic [ref=f2e20]:\n      - generic [ref=f2e21]:\n        - text: Email\n        - generic [aria-hidden] [ref=f2e22]: \"*\"\n      - textbox \"Email\" [ref=f2e23]: rohan.tsm.byufuel@yopmail.com\n    - generic [ref=f2e26]:\n      - generic [ref=f2e27]:\n        - generic [ref=f2e28]:\n          - text: Password\n          - generic [aria-hidden] [ref=f2e29]: \"*\"\n        - textbox \"Password\" [ref=f2e30]: R7m#Byuf\n      - button [ref=f2e32] [cursor=pointer]\n    - link \"Forgot password\" [ref=f2e40] [cursor=pointer]:\n      - /url: /auth/forgot-password\n    - button \"Login\" [active] [ref=f2e43] [cursor=pointer]\n  - contentinfo [ref=f2e50]:\n    - generic [ref=f2e51]: Copyright © 2026 Byufuel India Pvt. Ltd.\n    - generic [ref=f2e52]: Version 1.0.0 (20260922.1)\n    - generic [ref=f2e53]:\n      - generic [ref=f2e54] [cursor=pointer]: Privacy Policy\n      - generic [ref=f2e55] [cursor=pointer]: Terms",
  "events": "- New console entries: d:\\Travel VIP API Automation\\reports\\playwright-mcp\\console-2026-10-06T09-50-07-106Z.log#L3"
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "depth": 8
}
```
- Result
```json
{
  "page": "- Page URL: https://u-byufuel.azurewebsites.net/auth/login\n- Page Title: Login | BYUFUEL\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=f2e5]:\n  - generic [ref=f2e14]:\n    - heading \"Login\" [level=1] [ref=f2e16]\n    - generic [ref=f2e57]:\n      - generic [ref=f2e61]: Please login using Mobile App\n      - button [ref=f2e63] [cursor=pointer]\n    - generic [ref=f2e20]:\n      - generic [ref=f2e21]:\n        - text: Email\n        - generic [aria-hidden] [ref=f2e22]: \"*\"\n      - textbox \"Email\" [ref=f2e23]: rohan.tsm.byufuel@yopmail.com\n    - generic [ref=f2e26]:\n      - generic [ref=f2e27]:\n        - generic [ref=f2e28]:\n          - text: Password\n          - generic [aria-hidden] [ref=f2e29]: \"*\"\n        - textbox \"Password\" [ref=f2e30]: R7m#Byuf\n      - button [ref=f2e32] [cursor=pointer]\n    - link \"Forgot password\" [ref=f2e40] [cursor=pointer]:\n      - /url: /auth/forgot-password\n    - button \"Login\" [active] [ref=f2e43] [cursor=pointer]\n  - contentinfo [ref=f2e50]:\n    - generic [ref=f2e51]: Copyright © 2026 Byufuel India Pvt. Ltd.\n    - generic [ref=f2e52]: Version 1.0.0 (20260922.1)\n    - generic [ref=f2e53]:\n      - generic [ref=f2e54] [cursor=pointer]: Privacy Policy\n      - generic [ref=f2e55] [cursor=pointer]: Terms"
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "type": "png",
  "filename": "reports/byufuel-tsm-web-login.png",
  "fullPage": false,
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of viewport](reports\\byufuel-tsm-web-login.png)",
  "code": "// Screenshot viewport and save it as reports\\byufuel-tsm-web-login.png\nawait page.screenshot({\n  fullPage: false,\n  path: 'reports\\\\byufuel-tsm-web-login.png',\n  scale: 'css',\n  type: 'png'\n});"
}
```

### Tool call: browser_navigate
- Args
```json
{
  "url": "https://u-byufuel.azurewebsites.net/auth/login"
}
```
- Result
```json
{
  "code": "await page.goto('https://u-byufuel.azurewebsites.net/auth/login');",
  "page": "- Page URL: https://u-byufuel.azurewebsites.net/auth/login\n- Page Title: BYUFUEL | Centvis",
  "snapshot": "",
  "events": "- New console entries: d:\\Travel VIP API Automation\\reports\\playwright-mcp\\console-2026-10-06T09-56-33-805Z.log#L1"
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "depth": 6
}
```
- Result
```json
{
  "page": "- Page URL: https://u-byufuel.azurewebsites.net/auth/login\n- Page Title: Login | BYUFUEL",
  "inlineSnapshot": "- generic [ref=f3e5]:\n  - generic [ref=f3e14]:\n    - heading \"Login\" [level=1] [ref=f3e16]\n    - generic [ref=f3e20]:\n      - generic [ref=f3e21]:\n        - text: Email\n        - generic [aria-hidden] [ref=f3e22]: \"*\"\n      - textbox \"Email\" [ref=f3e23]\n    - generic [ref=f3e26]:\n      - generic [ref=f3e27]:\n        - generic [ref=f3e28]:\n          - text: Password\n          - generic [aria-hidden] [ref=f3e29]: \"*\"\n        - textbox \"Password\" [ref=f3e30]\n      - button [ref=f3e32] [cursor=pointer]\n    - link \"Forgot password\" [ref=f3e40] [cursor=pointer]:\n      - /url: /auth/forgot-password\n    - button \"Login\" [ref=f3e43] [cursor=pointer]\n  - contentinfo [ref=f3e50]:\n    - generic [ref=f3e51]: Copyright © 2026 Byufuel India Pvt. Ltd.\n    - generic [ref=f3e52]: Version 1.0.0 (20260922.1)\n    - generic [ref=f3e53]:\n      - generic [ref=f3e54] [cursor=pointer]: Privacy Policy\n      - generic [ref=f3e55] [cursor=pointer]: Terms",
  "events": "- New console entries: d:\\Travel VIP API Automation\\reports\\playwright-mcp\\console-2026-10-06T09-56-33-805Z.log#L2"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "f3e23",
      "name": "Email",
      "type": "textbox",
      "value": "qa.whworker.byufuel@yopmail.com"
    },
    {
      "target": "f3e30",
      "name": "Password",
      "type": "textbox",
      "value": "w6!CcGzV"
    }
  ]
}
```
- Result
```json
{
  "code": "await page.getByRole('textbox', { name: 'Email' }).fill('qa.whworker.byufuel@yopmail.com');\nawait page.getByRole('textbox', { name: 'Password' }).fill('w6!CcGzV');"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Login button",
  "target": "f3e43"
}
```
- Result
```json
{
  "code": "await page.getByRole('button', { name: 'Login' }).click();",
  "page": "- Page URL: https://u-byufuel.azurewebsites.net/auth/login\n- Page Title: Login | BYUFUEL\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=f3e5]:\n  - generic [ref=f3e14]:\n    - heading \"Login\" [level=1] [ref=f3e16]\n    - generic [ref=f3e57]:\n      - generic [ref=f3e61]: Email Id not registered\n      - button [ref=f3e63] [cursor=pointer]\n    - generic [ref=f3e20]:\n      - generic [ref=f3e21]:\n        - text: Email\n        - generic [aria-hidden] [ref=f3e22]: \"*\"\n      - textbox \"Email\" [ref=f3e23]: qa.whworker.byufuel@yopmail.com\n    - generic [ref=f3e26]:\n      - generic [ref=f3e27]:\n        - generic [ref=f3e28]:\n          - text: Password\n          - generic [aria-hidden] [ref=f3e29]: \"*\"\n        - textbox \"Password\" [ref=f3e30]: w6!CcGzV\n      - button [ref=f3e32] [cursor=pointer]\n    - link \"Forgot password\" [ref=f3e40] [cursor=pointer]:\n      - /url: /auth/forgot-password\n    - button \"Login\" [active] [ref=f3e43] [cursor=pointer]\n  - contentinfo [ref=f3e50]:\n    - generic [ref=f3e51]: Copyright © 2026 Byufuel India Pvt. Ltd.\n    - generic [ref=f3e52]: Version 1.0.0 (20260922.1)\n    - generic [ref=f3e53]:\n      - generic [ref=f3e54] [cursor=pointer]: Privacy Policy\n      - generic [ref=f3e55] [cursor=pointer]: Terms",
  "events": "- New console entries: d:\\Travel VIP API Automation\\reports\\playwright-mcp\\console-2026-10-06T09-56-33-805Z.log#L3"
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "depth": 8
}
```
- Result
```json
{
  "page": "- Page URL: https://u-byufuel.azurewebsites.net/auth/login\n- Page Title: Login | BYUFUEL\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=f3e5]:\n  - generic [ref=f3e14]:\n    - heading \"Login\" [level=1] [ref=f3e16]\n    - generic [ref=f3e57]:\n      - generic [ref=f3e61]: Email Id not registered\n      - button [ref=f3e63] [cursor=pointer]\n    - generic [ref=f3e20]:\n      - generic [ref=f3e21]:\n        - text: Email\n        - generic [aria-hidden] [ref=f3e22]: \"*\"\n      - textbox \"Email\" [ref=f3e23]: qa.whworker.byufuel@yopmail.com\n    - generic [ref=f3e26]:\n      - generic [ref=f3e27]:\n        - generic [ref=f3e28]:\n          - text: Password\n          - generic [aria-hidden] [ref=f3e29]: \"*\"\n        - textbox \"Password\" [ref=f3e30]: w6!CcGzV\n      - button [ref=f3e32] [cursor=pointer]\n    - link \"Forgot password\" [ref=f3e40] [cursor=pointer]:\n      - /url: /auth/forgot-password\n    - button \"Login\" [active] [ref=f3e43] [cursor=pointer]\n  - contentinfo [ref=f3e50]:\n    - generic [ref=f3e51]: Copyright © 2026 Byufuel India Pvt. Ltd.\n    - generic [ref=f3e52]: Version 1.0.0 (20260922.1)\n    - generic [ref=f3e53]:\n      - generic [ref=f3e54] [cursor=pointer]: Privacy Policy\n      - generic [ref=f3e55] [cursor=pointer]: Terms"
}
```

### Tool call: browser_navigate
- Args
```json
{
  "url": "https://d-byufuel.azurewebsites.net/auth/login"
}
```
- Result
```json
{
  "code": "await page.goto('https://d-byufuel.azurewebsites.net/auth/login');",
  "page": "- Page URL: https://d-byufuel.azurewebsites.net/auth/login\n- Page Title: BYUFUEL | Centvis",
  "snapshot": "",
  "events": "- New console entries: d:\\Travel VIP API Automation\\reports\\playwright-mcp\\console-2026-10-06T09-57-14-815Z.log#L1"
}
```

### Tool call: browser_wait_for
- Args
```json
{
  "text": "Login"
}
```
- Result
```json
{
  "result": "Waited for Login",
  "code": "await page.getByText(\"Login\").first().waitFor({ state: 'visible' });",
  "page": "- Page URL: https://d-byufuel.azurewebsites.net/auth/login\n- Page Title: Login | BYUFUEL",
  "snapshot": "- generic [ref=f4e5]:\n  - generic [ref=f4e14]:\n    - heading \"Login\" [level=1] [ref=f4e16]\n    - generic [ref=f4e20]:\n      - generic [ref=f4e21]:\n        - text: Email\n        - generic [aria-hidden] [ref=f4e22]: \"*\"\n      - textbox \"Email\" [ref=f4e23]\n    - generic [ref=f4e26]:\n      - generic [ref=f4e27]:\n        - generic [ref=f4e28]:\n          - text: Password\n          - generic [aria-hidden] [ref=f4e29]: \"*\"\n        - textbox \"Password\" [ref=f4e30]\n      - button [ref=f4e32] [cursor=pointer]\n    - link \"Forgot password\" [ref=f4e40] [cursor=pointer]:\n      - /url: /auth/forgot-password\n    - button \"Login\" [ref=f4e43] [cursor=pointer]\n  - contentinfo [ref=f4e50]:\n    - generic [ref=f4e51]: Copyright © 2026 Byufuel India Pvt. Ltd.\n    - generic [ref=f4e52]: Version 1.0.0 (20260917.2)\n    - generic [ref=f4e53]:\n      - generic [ref=f4e54] [cursor=pointer]: Privacy Policy\n      - generic [ref=f4e55] [cursor=pointer]: Terms",
  "events": "- New console entries: d:\\Travel VIP API Automation\\reports\\playwright-mcp\\console-2026-10-06T09-57-14-815Z.log#L2"
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "depth": 6
}
```
- Result
```json
{
  "page": "- Page URL: https://d-byufuel.azurewebsites.net/auth/login\n- Page Title: Login | BYUFUEL",
  "inlineSnapshot": "- generic [ref=f4e5]:\n  - generic [ref=f4e14]:\n    - heading \"Login\" [level=1] [ref=f4e16]\n    - generic [ref=f4e20]:\n      - generic [ref=f4e21]:\n        - text: Email\n        - generic [aria-hidden] [ref=f4e22]: \"*\"\n      - textbox \"Email\" [ref=f4e23]\n    - generic [ref=f4e26]:\n      - generic [ref=f4e27]:\n        - generic [ref=f4e28]:\n          - text: Password\n          - generic [aria-hidden] [ref=f4e29]: \"*\"\n        - textbox \"Password\" [ref=f4e30]\n      - button [ref=f4e32] [cursor=pointer]\n    - link \"Forgot password\" [ref=f4e40] [cursor=pointer]:\n      - /url: /auth/forgot-password\n    - button \"Login\" [ref=f4e43] [cursor=pointer]\n  - contentinfo [ref=f4e50]:\n    - generic [ref=f4e51]: Copyright © 2026 Byufuel India Pvt. Ltd.\n    - generic [ref=f4e52]: Version 1.0.0 (20260917.2)\n    - generic [ref=f4e53]:\n      - generic [ref=f4e54] [cursor=pointer]: Privacy Policy\n      - generic [ref=f4e55] [cursor=pointer]: Terms"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "f4e23",
      "name": "Email",
      "type": "textbox",
      "value": "qa.whworker.byufuel@yopmail.com"
    },
    {
      "target": "f4e30",
      "name": "Password",
      "type": "textbox",
      "value": "w6!CcGzV"
    }
  ]
}
```
- Result
```json
{
  "code": "await page.getByRole('textbox', { name: 'Email' }).fill('qa.whworker.byufuel@yopmail.com');\nawait page.getByRole('textbox', { name: 'Password' }).fill('w6!CcGzV');"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Login button",
  "target": "f4e43"
}
```
- Result
```json
{
  "code": "await page.getByRole('button', { name: 'Login' }).click();",
  "page": "- Page URL: https://d-byufuel.azurewebsites.net/auth/login\n- Page Title: Login | BYUFUEL",
  "snapshot": "- generic [ref=f4e5]:\n  - generic [ref=f4e14]:\n    - heading \"Login\" [level=1] [ref=f4e16]\n    - generic [ref=f4e20]:\n      - generic [ref=f4e21]:\n        - text: Email\n        - generic [aria-hidden] [ref=f4e22]: \"*\"\n      - textbox \"Email\" [ref=f4e23]: qa.whworker.byufuel@yopmail.com\n    - generic [ref=f4e26]:\n      - generic [ref=f4e27]:\n        - generic [ref=f4e28]:\n          - text: Password\n          - generic [aria-hidden] [ref=f4e29]: \"*\"\n        - textbox \"Password\" [ref=f4e30]: w6!CcGzV\n      - button [ref=f4e32] [cursor=pointer]\n    - link \"Forgot password\" [ref=f4e40] [cursor=pointer]:\n      - /url: /auth/forgot-password\n    - button \"Login\" [active] [ref=f4e43] [cursor=pointer]\n  - contentinfo [ref=f4e50]:\n    - generic [ref=f4e51]: Copyright © 2026 Byufuel India Pvt. Ltd.\n    - generic [ref=f4e52]: Version 1.0.0 (20260917.2)\n    - generic [ref=f4e53]:\n      - generic [ref=f4e54] [cursor=pointer]: Privacy Policy\n      - generic [ref=f4e55] [cursor=pointer]: Terms"
}
```

### Tool call: browser_wait_for
- Args
```json
{
  "time": 3
}
```
- Result
```json
{
  "result": "Waited for 3 seconds",
  "code": "await new Promise(f => setTimeout(f, 3 * 1000));",
  "page": "- Page URL: https://d-byufuel.azurewebsites.net/forbidden\n- Page Title: 403 - Forbidden | BYUFUEL\n- Console: 4 errors, 0 warnings",
  "snapshot": "- generic [ref=f4e58]:\n  - generic [ref=f4e60]:\n    - img \"Byufuel\" [ref=f4e62]\n    - navigation [ref=f4e63]:\n      - list [ref=f4e64]:\n        - listitem [ref=f4e65]:\n          - list [ref=f4e66]:\n            - listitem [ref=f4e67]:\n              - link \"Dashboard\" [ref=f4e68] [cursor=pointer]:\n                - /url: /dsh/dashboard\n            - listitem [ref=f4e69]:\n              - link \"Generate QR Codes\" [ref=f4e70] [cursor=pointer]:\n                - /url: /uam/container-qr-codes\n            - listitem [ref=f4e71]:\n              - link \"Container Management\" [ref=f4e72] [cursor=pointer]:\n                - /url: /uam/container-management\n            - listitem [ref=f4e73]:\n              - link \"Check in Oil\" [ref=f4e74] [cursor=pointer]:\n                - /url: /byu/checkin-oil\n            - listitem [ref=f4e75]:\n              - link \"Collect Oil From Supplier\" [ref=f4e76] [cursor=pointer]:\n                - /url: /byu/collect-oil\n  - generic [ref=f4e77]:\n    - generic:\n      - generic:\n        - generic:\n          - heading [level=2]\n    - generic [ref=f4e78]:\n      - button [ref=f4e81] [cursor=pointer]\n      - generic [ref=f4e92]:\n        - button [ref=f4e93] [cursor=pointer]\n        - generic [aria-hidden]: \"12\"\n      - button \"QW QA WHWorker\" [ref=f4e100] [cursor=pointer]:\n        - generic [ref=f4e101]: QW\n        - generic [ref=f4e102]: QA WHWorker\n  - main [ref=f4e105]:\n    - generic [ref=f4e107]:\n      - heading \"403 - Forbidden\" [level=2] [ref=f4e108]\n      - paragraph [ref=f4e113]: You are not authorized to perform this action. Please contact your administrator if you think this is a mistake.\n    - generic [ref=f4e115]:\n      - generic [ref=f4e116]: Copyright © 2026 Byufuel India Pvt. Ltd.\n      - generic [ref=f4e117]: Version 1.0.0 (20260917.2)\n      - generic [ref=f4e118]:\n        - generic [ref=f4e119] [cursor=pointer]: Privacy Policy\n        - generic [ref=f4e120] [cursor=pointer]: Terms",
  "events": "- New console entries: d:\\Travel VIP API Automation\\reports\\playwright-mcp\\console-2026-10-06T09-57-14-815Z.log#L3-L8"
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "depth": 6
}
```
- Result
```json
{
  "page": "- Page URL: https://d-byufuel.azurewebsites.net/forbidden\n- Page Title: 403 - Forbidden | BYUFUEL\n- Console: 4 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=f4e58]:\n  - generic [ref=f4e60]:\n    - img \"Byufuel\" [ref=f4e62]\n    - navigation [ref=f4e63]:\n      - list [ref=f4e64]:\n        - listitem [ref=f4e65]:\n          - list [ref=f4e66]:\n            - listitem [ref=f4e67]\n            - listitem [ref=f4e69]\n            - listitem [ref=f4e71]\n            - listitem [ref=f4e73]\n            - listitem [ref=f4e75]\n  - generic [ref=f4e77]:\n    - generic:\n      - generic:\n        - generic:\n          - heading [level=2]\n    - generic [ref=f4e78]:\n      - button [ref=f4e81] [cursor=pointer]\n      - generic [ref=f4e92]:\n        - button [ref=f4e93] [cursor=pointer]\n        - generic [aria-hidden]: \"12\"\n      - button \"QW QA WHWorker\" [ref=f4e100] [cursor=pointer]:\n        - generic [ref=f4e101]: QW\n        - generic [ref=f4e102]: QA WHWorker\n  - main [ref=f4e105]:\n    - generic [ref=f4e107]:\n      - heading \"403 - Forbidden\" [level=2] [ref=f4e108]\n      - paragraph [ref=f4e113]: You are not authorized to perform this action. Please contact your administrator if you think this is a mistake.\n    - generic [ref=f4e115]:\n      - generic [ref=f4e116]: Copyright © 2026 Byufuel India Pvt. Ltd.\n      - generic [ref=f4e117]: Version 1.0.0 (20260917.2)\n      - generic [ref=f4e118]:\n        - generic [ref=f4e119] [cursor=pointer]: Privacy Policy\n        - generic [ref=f4e120] [cursor=pointer]: Terms"
}
```
