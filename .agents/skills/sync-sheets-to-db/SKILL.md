# Sync Google Sheets to Database

Syncs session and testing data from the Cranbrook Rowing S&C Google Sheet into the app database.

## What it does

- Fetches session data from athlete tabs (AF, RR, JC, MA, TL, CC, SK, AS, AD, OO)
- Fetches testing data from Core_Testing_Responses tab
- Clears and replaces all records in SessionLog and TestingResult entities
- Reports results and errors

## Usage

```
run_skill sync-sheets-to-db
```

## Setup

Requires Google Sheets OAuth authorization.
