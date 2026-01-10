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

        console.log(`Processing: ${objName}`);

        // הורדת הקובץ
        const getObj = await storageClient.getObject({
          namespaceName: NAMESPACE,
          bucketName: INPUT_BUCKET,
          objectName: objName
        });

        const writer = fs.createWriteStream(localInput);
        for await (const chunk of getObj.value) { writer.write(chunk); }
        writer.end();
        await new Promise(res => writer.on('finish', res));

        // רינדור בבלנדר - השורה המעודכנת
        console.log("Rendering with Blender 4.0 (Cycles CPU)...");
        await new Promise((res, rej) => {
        // exec(`/home/ubuntu/blender-4.0.2...`); // נטרלנו את בלנדר לרגע
exec(`convert -size 100x100 xc:red ${localOutput}`, (err) => err ? rej(err) : res());
          // exec(`/home/ubuntu/blender-4.0.2-linux-x64/blender -b ${localInput} -E CYCLES -o ${localOutput.replace('.png', '')} -F PNG -f 1 -- --cycles-device CPU --samples 4`, (err) => err ? rej(err) : res());
        });

        // העלאת תוצאה
        console.log("Uploading result...");
        await storageClient.putObject({
          namespaceName: NAMESPACE,
          bucketName: OUTPUT_BUCKET,
          objectName: `rendered_${outputBase}.png`,
          putObjectBody: fs.createReadStream(localOutput)
        });

        // מחיקה מה-Input ומקומי
        await storageClient.deleteObject({ namespaceName: NAMESPACE, bucketName: INPUT_BUCKET, objectName: objName });
        if (fs.existsSync(localInput)) fs.unlinkSync(localInput);
        if (fs.existsSync(localOutput)) fs.unlinkSync(localOutput);

        console.log("Done! Waiting for next file...");
      } catch (e) {
        console.error("Loop error:", e.message);
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  } catch (e) {
    console.error("Fatal:", e.message);
    process.exit(1);
  }
}

main();