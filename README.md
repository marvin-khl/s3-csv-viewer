# S3 CSV Viewer

Opens a CSV file from an Amazon S3 bucket using **AWS CLI v2** and displays it in VS Code.

## Features

- Download an S3 object via `aws s3 cp s3://... -`
- Opens the CSV in a new editor tab
- Optional auto-open on startup

## Requirements

- **AWS CLI v2** installed and on your PATH
- Valid AWS credentials (profile, SSO, role, or environment)
- Permission `s3:GetObject` on the target object

## Extension Settings

This extension contributes the following settings:

| Setting                         | Type    | Description                                 |
| ------------------------------- | ------- | ------------------------------------------- |
| `s3CsvViewer.s3Uri`             | string  | S3 URI, e.g. `s3://my-bucket/path/file.csv` |
| `s3CsvViewer.awsProfile`        | string  | Optional AWS profile, e.g. `default`, `dev` |
| `s3CsvViewer.awsRegion`         | string  | Optional region, e.g. `eu-central-1`        |
| `s3CsvViewer.autoOpenOnStartup` | boolean | Open on VS Code startup                     |

## Commands

- **S3: Open CSV from Bucket** (`s3CsvViewer.openCsvFromS3`)

## Usage

1. Configure settings or run the command from the Command Palette.
2. Enter the S3 URI when prompted.
3. The CSV opens in a new editor tab.
