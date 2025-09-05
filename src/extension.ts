import { execFile, spawn } from "child_process";
import * as fss from "fs";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

/**
 * Runs the AWS CLI with given arguments and optional environment variables.
 * Returns the stdout as a Buffer.
 */
function runAwsCli(
  args: string[],
  envExtras: Record<string, string> = {}
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      process.platform === "win32" ? "aws.exe" : "aws",
      args,
      {
        env: { ...process.env, ...envExtras },
      },
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
 * Downloads a CSV file from S3 to a temporary file using AWS CLI.
 * Returns the local path to the downloaded file.
 */
async function fetchCsvToTemp(
  s3Uri: string,
  profile?: string,
  region?: string
): Promise<string> {
  if (!s3Uri || !s3Uri.startsWith("s3://")) {
    throw new Error(
      "Please provide a valid S3 URI (e.g., s3://bucket/key.csv)."
    );
  }

  const envExtras: Record<string, string> = {};
  if (profile) {
    envExtras.AWS_PROFILE = profile;
  }
  if (region) {
    envExtras.AWS_REGION = region;
  }

  const fileName = path.basename(s3Uri) || "s3.csv";
  const tmpPath = path.join(
    os.tmpdir(),
    `s3-csv-viewer-${Date.now()}-${fileName}`
  );

  try {
    await awsS3CpToFile(s3Uri, tmpPath, envExtras);
    return tmpPath;
  } catch (e) {
    // Partielle Datei bei Fehler entfernen (Cleanup)
    try {
      await fs.unlink(tmpPath);
    } catch {}
    throw e;
  }
}

async function awsS3CpToFile(
  s3Uri: string,
  destPath: string,
  envExtras: Record<string, string> = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    const awsCmd = process.platform === "win32" ? "aws.exe" : "aws";
    const args = [
      "s3",
      "cp",
      s3Uri,
      "-",
      "--no-progress",
      "--only-show-errors",
    ];

    const child = spawn(awsCmd, args, {
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
      // Stream schließen, dann auf Exitcode prüfen
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
 * Main command: Prompts for or uses configured S3 URI,
 * downloads CSV, and opens it in VS Code.
 */
async function openCsvFromS3(
  context: vscode.ExtensionContext,
  uriFromInput?: string
) {
  const cfg = vscode.workspace.getConfiguration("s3CsvViewer");
  const configuredUri = cfg.get<string>("s3Uri")?.trim() || "";
  const profile = cfg.get<string>("awsProfile")?.trim() || "";
  const region = cfg.get<string>("awsRegion")?.trim() || "";

  const s3Uri =
    uriFromInput ||
    configuredUri ||
    (await vscode.window.showInputBox({
      placeHolder: "s3://bucket/key.csv",
      prompt: "S3 URI of the CSV file",
      ignoreFocusOut: true,
      validateInput: (val) =>
        val.startsWith("s3://") ? undefined : "Must start with s3://",
    }));

  if (!s3Uri) {
    return;
  }

  try {
    const tmpPath = await fetchCsvToTemp(s3Uri, profile, region);

    // Open CSV as a text document; VS Code usually detects .csv automatically
    const doc = await vscode.workspace.openTextDocument(
      vscode.Uri.file(tmpPath)
    );
    await vscode.window.showTextDocument(doc, { preview: false });

    // Force CSV language mode if not detected
    if (doc.languageId !== "csv") {
      await vscode.languages.setTextDocumentLanguage(doc, "csv");
    }

    vscode.window.setStatusBarMessage(`S3 CSV loaded: ${s3Uri}`, 5000);
  } catch (err: any) {
    vscode.window.showErrorMessage(
      `Failed to load CSV. ${err?.message ?? String(err)}`
    );
  }
}

/**
 * Extension activation entry point.
 * Registers commands and auto-opens the CSV if configured.
 */
export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand(
    "s3CsvViewer.openCsvFromS3",
    async () => openCsvFromS3(context)
  );

  context.subscriptions.push(disposable);

  // Auto-open on startup if enabled
  const cfg = vscode.workspace.getConfiguration("s3CsvViewer");
  const auto = cfg.get<boolean>("autoOpenOnStartup");

  if (auto) {
    // Don't block startup; ignore errors
    openCsvFromS3(context).catch(() => {});
  }
}

/**
 * Extension deactivation hook.
 * Nothing to clean up in this extension.
 */
export function deactivate() {
  // Nothing to clean up
}
