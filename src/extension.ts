import { execFile, spawn } from "child_process";
import * as fss from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

/**
 * Returns the AWS CLI command name depending on the platform
 * (Windows uses `aws.exe`, others use `aws`).
 */
function awsCmdName() {
  return process.platform === "win32" ? "aws.exe" : "aws";
}

/**
 * Runs the AWS CLI with given arguments and environment variables.
 * Returns stdout as a Buffer or throws an error with stderr.
 */
function runAwsCli(
  args: string[],
  envExtras: Record<string, string> = {}
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      awsCmdName(),
      args,
      { env: { ...process.env, ...envExtras } },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(`AWS CLI error: ${error.message}\nSTDERR: ${stderr}`)
          );
        } else {
          resolve(Buffer.from(stdout, "utf-8"));
        }
      }
    );
  });
}

/**
 * Downloads a file from S3 to a local path using `aws s3 cp`.
 * Pipes file content to a local write stream.
 */
async function awsS3CpToFile(
  s3Uri: string,
  destPath: string,
  envExtras: Record<string, string> = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      "s3",
      "cp",
      s3Uri,
      "-",
      "--no-progress",
      "--only-show-errors",
    ];
    const child = spawn(awsCmdName(), args, {
      env: { ...process.env, ...envExtras },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const out = fss.createWriteStream(destPath);
    let stderrBuf = "";

    child.stdout.pipe(out);

    child.stderr.on("data", (d) => (stderrBuf += d.toString()));
    out.on("error", (err) => {
      child.kill("SIGKILL");
      reject(err);
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      out.close(() => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error(`AWS CLI exited with code ${code}: ${stderrBuf.trim()}`)
          );
        }
      });
    });
  });
}

/**
 * Downloads a selected S3 file and opens it in the VS Code editor.
 * The file is stored in a temporary directory.
 */
async function openS3FileInEditor(
  s3Uri: string,
  profile?: string,
  region?: string
) {
  const envExtras: Record<string, string> = {};
  if (profile) {
    envExtras.AWS_PROFILE = profile;
  }
  if (region) {
    envExtras.AWS_REGION = region;
  }

  const fileName = path.basename(s3Uri);
  const tmpPath = path.join(os.tmpdir(), `s3-viewer-${Date.now()}-${fileName}`);

  await awsS3CpToFile(s3Uri, tmpPath, envExtras);

  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(tmpPath));
  await vscode.window.showTextDocument(doc, { preview: false });
  vscode.window.setStatusBarMessage(`S3 File loaded: ${s3Uri}`, 5000);
}

/**
 * Displays QuickPick dropdowns to:
 * 1. Select a bucket
 * 2. Select a file within that bucket
 * Then opens the selected file in the editor.
 */
async function pickAndOpenS3File(context: vscode.ExtensionContext) {
  const cfg = vscode.workspace.getConfiguration("s3CsvViewer");
  const env: Record<string, string> = {};
  const profile = cfg.get<string>("awsProfile")?.trim();
  const region = cfg.get<string>("awsRegion")?.trim();
  if (profile) {
    env.AWS_PROFILE = profile;
  }
  if (region) {
    env.AWS_REGION = region;
  }

  try {
    // Fetch buckets
    const rawBuckets = await runAwsCli(
      ["s3api", "list-buckets", "--output", "json"],
      env
    );
    const dataBuckets = JSON.parse(rawBuckets.toString());
    const buckets: string[] = dataBuckets.Buckets.map((b: any) => b.Name);

    const bucket = await vscode.window.showQuickPick(buckets, {
      placeHolder: "Select an S3 bucket",
    });
    if (!bucket) {
      return;
    }

    // Fetch objects in the selected bucket
    const rawObjs = await runAwsCli(
      ["s3api", "list-objects-v2", "--bucket", bucket, "--output", "json"],
      env
    );
    const dataObjs = JSON.parse(rawObjs.toString());
    const keys: string[] = (dataObjs.Contents || []).map((o: any) => o.Key);

    const key = await vscode.window.showQuickPick(keys, {
      placeHolder: `Select file from ${bucket}`,
    });
    if (!key) {
      return;
    }

    const s3Uri = `s3://${bucket}/${key}`;
    await openS3FileInEditor(s3Uri, profile, region);
  } catch (err: any) {
    vscode.window.showErrorMessage(`Error: ${err?.message}`);
  }
}

/**
 * Called when the extension is activated.
 * Registers the main command to pick and open S3 files.
 */
export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand(
    "s3CsvViewer.openCsvFromS3",
    async () => pickAndOpenS3File(context)
  );
  context.subscriptions.push(disposable);
}

/**
 * Called when the extension is deactivated.
 * Currently no cleanup is required.
 */
export function deactivate() {}
