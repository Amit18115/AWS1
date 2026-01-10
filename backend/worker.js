const common = require("oci-common");
const os = require("oci-objectstorage");
const fs = require("fs");
const { exec } = require("child_process");

const NAMESPACE = "axamiken9q9h";
const INPUT_BUCKET = "render_input_bucket";
const OUTPUT_BUCKET = "render_output_bucket";

async function main() {
  try {
    const provider = await new common.InstancePrincipalsAuthenticationDetailsProviderBuilder().build();
    const storageClient = new os.ObjectStorageClient({ authenticationDetailsProvider: provider });

    console.log("Worker started: Polling for .blend files...");

    while (true) {
      try {
        // 1. קבלת רשימת אובייקטים
        const list = await storageClient.listObjects({
          namespaceName: NAMESPACE,
          bucketName: INPUT_BUCKET
        });

        const blendFile = (list.listObjects.objects || []).find(o => o.name.toLowerCase().endsWith(".blend"));

        if (!blendFile) {
          await new Promise(r => setTimeout(r, 5000));
          continue;
        }

        const objName = blendFile.name;
        const localInput = `/home/ubuntu/${objName}`;
        const outputBase = objName.replace(/\.[^/.]+$/, "");
        const localOutput = `/home/ubuntu/rendered_${outputBase}.png`;

        console.log(`--- New Job: ${objName} ---`);

        // 2. הורדת הקובץ מ-Object Storage
        console.log("Downloading input file...");
        const getObj = await storageClient.getObject({
          namespaceName: NAMESPACE,
          bucketName: INPUT_BUCKET,
          objectName: objName
        });

        const writer = fs.createWriteStream(localInput);
        for await (const chunk of getObj.value) { writer.write(chunk); }
        writer.end();
        await new Promise(res => writer.on('finish', res));

        // 3. רינדור בבלנדר (מנוע מהיר ללא Cycles כדי למנוע קריסות זיכרון)
        console.log("Rendering with Blender (Fast Mode)...");
        await new Promise((res, rej) => {
          // פקודה זו משתמשת במנוע הדיפולטי שהוא המהיר ביותר למכונות Micro
const blenderCmd = `/home/ubuntu/blender-4.0.2-linux-x64/blender -b "${localInput}" -o "${localOutput.replace('.png', '')}####" -F PNG -f 1`;          exec(blenderCmd, (err, stdout, stderr) => {
            if (err) {
              console.error("Blender Exec Error:", stderr);
              return rej(err);
            }
            res();
          });
        });

       // 4. איתור הקובץ המרונדר (בדיקה של כל האופציות שבלנדר מייצר)
let fileToUpload = localOutput;
const possibleNames = [
  localOutput,
  localOutput.replace('.png', '0001.png'),
  localOutput.replace('.png', '1.png')
];

for (const name of possibleNames) {
  if (fs.existsSync(name) && fs.statSync(name).size > 0) {
    fileToUpload = name;
    break;
  }
}

        // 5. העלאת תוצאה רק אם הקובץ תקין ולא ריק
        if (fs.existsSync(fileToUpload) && fs.statSync(fileToUpload).size > 0) {
          console.log(`Uploading result: ${fileToUpload} (${fs.statSync(fileToUpload).size} bytes)`);
          
          await storageClient.putObject({
            namespaceName: NAMESPACE,
            bucketName: OUTPUT_BUCKET,
            objectName: `rendered_${outputBase}.png`,
            putObjectBody: fs.createReadStream(fileToUpload)
          });
          console.log("Upload successful!");
        } else {
          throw new Error("Render failed: Output file is missing or empty (0 bytes).");
        }

        // 6. ניקוי: מחיקה מה-Input ומקומי
        await storageClient.deleteObject({ namespaceName: NAMESPACE, bucketName: INPUT_BUCKET, objectName: objName });
        if (fs.existsSync(localInput)) fs.unlinkSync(localInput);
        if (fs.existsSync(fileToUpload)) fs.unlinkSync(fileToUpload);
        if (fs.existsSync(localOutput)) fs.unlinkSync(localOutput); // ליתר ביטחון

        console.log("Done! Searching for next job...");
      } catch (e) {
        console.error("Loop error:", e.message);
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  } catch (e) {
    console.error("Fatal Worker Error:", e.message);
    process.exit(1);
  }
}

main();