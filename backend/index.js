const express = require('express');
const common = require("oci-common");
const core = require("oci-core");
const os = require("oci-objectstorage");

const app = express();
app.use(express.json());

// יצירת ספק אימות המבוסס על זהות המכונה (Dynamic Group)
const provider = new common.InstancePrincipalsAuthenticationDetailsProviderBuilder().build();

// הגדרות OCID - יש לוודא שהערכים תואמים ל-Outputs של ה-Terraform
const WORKER_INSTANCE_ID = process.env.WORKER_INSTANCE_ID;

if (!WORKER_INSTANCE_ID) {
    console.error("ERROR: WORKER_INSTANCE_ID environment variable is not set!");
}
const INPUT_BUCKET = "render_input_bucket";
const OUTPUT_BUCKET = "render_output_bucket";
const NAMESPACE = "axamiken9q9h"; // כפי שמופיע ב-plan שלכם

// יצירת קליינטים לניהול המשאבים
const computeClient = new core.ComputeClient({ authenticationDetailsProvider: provider });
const storageClient = new os.ObjectStorageClient({ authenticationDetailsProvider: provider });

// 1. נתיב להתחלת רינדור (POST /render)
app.post('/render', async (req, res) => {
    const { filename } = req.body;
    if (!filename) return res.status(400).json({ error: "Missing filename" });

    try {
        console.log(`Starting Worker for file: ${filename}`);
        
        // שליחת פקודה להדלקת ה-Worker
        await computeClient.instanceAction({
            instanceId: WORKER_INSTANCE_ID,
            action: "START"
        });

        res.json({ 
            status: "Job started", 
            message: `Worker ${WORKER_INSTANCE_ID} is powering up.` 
        });
    } catch (error) {
        console.error("Error starting worker:", error);
        res.status(500).json({ error: error.message });
    }
});

// 2. נתיב לבדיקת סטטוס (GET /status/:filename)
app.get('/status/:filename', async (req, res) => {
    const filename = req.params.filename;
    const renderedName = `rendered_${filename.split('.')[0]}.png`;

    try {
        // בדיקה האם הקובץ המרונדר כבר קיים בבאקט הפלט
        await storageClient.headObject({
            namespaceName: NAMESPACE,
            bucketName: OUTPUT_BUCKET,
            objectName: renderedName
        });

        // אם לא נזרקה שגיאה, הקובץ נמצא
        res.json({ 
            status: "Completed", 
            url: `https://objectstorage.il-jerusalem-1.oraclecloud.com/n/${NAMESPACE}/b/${OUTPUT_BUCKET}/o/${renderedName}` 
        });
    } catch (error) {
        if (error.statusCode === 404) {
            res.json({ status: "Processing" });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

const PORT = 80;
app.listen(PORT, () => {
    console.log(`Controller Backend running on port ${PORT}`);
});