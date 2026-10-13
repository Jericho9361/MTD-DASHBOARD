# MTD Sales Dashboard (MEG MTD template)

Month-to-Date sales dashboard built on **MEG_MTD_OCTOBER_1-31__2026.xlsx**.
Type the daily LS_RPRO figures and the KPIs update immediately. **Send** e-mails
`FranchiseDev@tobys.com` with the filled workbook attached, using the same sheets, formulas and layout as the original.

**No server, no database.** Everything is saved only in the browser of the device you use
(phone or PC). Nothing is uploaded anywhere. Use *Settings › Back up (JSON)* to keep a copy or
move the data to another device.

## Publish on GitHub Pages
1. Upload every file in this folder to the repository's main branch (keep the folders as they are).
2. Go to **Settings › Pages**, set Source to **Deploy from a branch**, choose **main** and **/(root)**, then click **Save**.
3. Open `https://<username>.github.io/<repo>/`. On a phone, choose *Add to Home Screen* so it runs like an app and works offline.

## How Send works
- **Phone:** the share menu opens with the workbook attached. Choose Gmail or Outlook.
- **Computer:** the workbook downloads and your mail app opens, already addressed to Franchise Dev. Attach the downloaded file.

## Files
```
index.html            the app
js/engine.js          workbook formulas ported 1:1 (cell references in comments)
js/exporter.js        fills the original .xlsx for the attachment
js/app.js             UI, tabs, device storage, send
js/template.js        the original workbook (embedded)
js/seed.js            starting data = October inputs from the workbook
tools/                tests (engine vs Excel values, export vs LibreOffice recalculation)
```

## Template notes
Formulas were copied exactly, including a few cells that differ from their neighbours
(`Seasonality!H25` uses `K25`, `SAME DAY!D7:D9` divide by TY, and `YTD-SALES!S1` counts row 33 twice).

These were corrected because they pointed at the wrong place:
- `LS_RPRO!AC6:AC19` linked to an old external file.
- `DEPOSIT SUMMARY!G24:G38` were offset two rows.
- Running days `J20` is now automatic (you can still type a number).
- The weekly `%` formulas and `YTD-SALES!J13:K17` now use one formula on every row.
