data "oci_identity_availability_domains" "ads" {
  # This should be your tenancy OCID
  compartment_id = var.tenancy_ocid
}
# ==========================================================
# 1. חיפוש אוטומטי של ה-Image המתאים ל-AMD (x86_64)
# ==========================================================
data "oci_core_images" "ubuntu_x86" {
  compartment_id           = var.compartment_ocid
  operating_system         = "Canonical Ubuntu"
  operating_system_version = "22.04"
  shape                    = "VM.Standard.E2.1.Micro"
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
}

# ==========================================================
# 2. הגדרת המכונה החלשה (AMD Micro)
# ==========================================================
resource "oci_core_instance" "render_worker" {
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[0].name
  compartment_id      = var.compartment_ocid
  shape               = "VM.Standard.E2.1.Micro" # שינוי ל-Micro

  # שים לב: הורדנו את ה-shape_config כי ב-Micro המשאבים קבועים (1 CPU, 1GB RAM)

  source_details {
    source_type = "image"
    # משתמש בתוצאה של החיפוש מלמעלה
    source_id   = data.oci_core_images.ubuntu_x86.images[0].id 
  }

  create_vnic_details {
    subnet_id        = oci_core_subnet.render_subnet.id
    display_name     = "primaryvnic"
    assign_public_ip = true
  }

 metadata = {
  ssh_authorized_keys = file(var.ssh_public_key_path)

  user_data = base64encode(<<-CLOUDINIT
    #!/bin/bash
    set -e

    # 0) Swap (4GB) כדי לעזור ל-1GB RAM
    fallocate -l 4G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=4096
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab

    # 1) עדכון והתקנת Blender + כלים
    apt-get update
    apt-get install -y blender git

    # 2) התקנת Node.js 18 + PM2
    curl -sL https://deb.nodesource.com/setup_18.x | bash -
    apt-get install -y nodejs
    npm install -g pm2

    echo "Installation complete with Swap + Blender + Node + PM2" > /home/ubuntu/status.txt

    # 3) יצירת  (שים לב: פה משתמשים ב-WORKERJS ולא EOF)
    cat > /home/ubuntu/worker.js <<'WORKERJS'
    const common = require("oci-common");
    const os = require("oci-objectstorage");

    const NAMESPACE = process.env.OCI_NAMESPACE || "axamiken9q9h";
    const INPUT_BUCKET = process.env.INPUT_BUCKET || "render_input_bucket";
    const OUTPUT_BUCKET = process.env.OUTPUT_BUCKET || "render_output_bucket";

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    // PNG קטן 1x1 (דמה) להוכחת pipeline
    const DUMMY_PNG_BASE64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO4B8yQAAAAASUVORK5CYII=";

    async function main() {
      const provider = await new common.InstancePrincipalsAuthenticationDetailsProviderBuilder().build();
      const storageClient = new os.ObjectStorageClient({ authenticationDetailsProvider: provider });

      console.log("Worker started:", { NAMESPACE, INPUT_BUCKET, OUTPUT_BUCKET });

      while (true) {
        try {
          const list = await storageClient.listObjects({
            namespaceName: NAMESPACE,
            bucketName: INPUT_BUCKET
          });

          const objs = list.listObjects.objects || [];
          const blend = objs.find(o => o.name.toLowerCase().endsWith(".blend"));

          if (!blend) {
            await sleep(3000);
            continue;
          }

          const objName = blend.name;
          const baseName = objName.replace(/\.[^/.]+$/, "");
          const outName = "rendered_" + baseName + ".png";

          console.log("Processing:", objName, "=>", outName);

          const pngBuffer = Buffer.from(DUMMY_PNG_BASE64, "base64");

          await storageClient.putObject({
            namespaceName: NAMESPACE,
            bucketName: OUTPUT_BUCKET,
            objectName: outName,
            putObjectBody: pngBuffer,
            contentType: "image/png"
          });

          await storageClient.deleteObject({
            namespaceName: NAMESPACE,
            bucketName: INPUT_BUCKET,
            objectName: objName
          });

          console.log("Done:", outName);
        } catch (e) {
          console.error("Worker error:", e.message);
          await sleep(3000);
        }
      }
    }

    main().catch(e => {
      console.error("Fatal:", e);
      process.exit(1);
    });
WORKERJS

    # 4) התקנת חבילות Node לפרויקט worker
    cd /home/ubuntu
    npm init -y
    npm i oci-common oci-objectstorage

    # 5) ENV קבוע לכל המשתמשים
    cat > /etc/profile.d/worker_vars.sh <<'VARS'
    export OCI_NAMESPACE="axamiken9q9h"
    export INPUT_BUCKET="render_input_bucket"
    export OUTPUT_BUCKET="render_output_bucket"
VARS
    chmod +x /etc/profile.d/worker_vars.sh

    # 6) הרשאות והרצת PM2 תחת ubuntu
    chown -R ubuntu:ubuntu /home/ubuntu

    sudo -u ubuntu bash -lc "source /etc/profile.d/worker_vars.sh; pm2 start /home/ubuntu/worker.js --name render-worker"
    sudo -u ubuntu bash -lc "pm2 save"

    # 7) (מומלץ) להרים את PM2 אוטומטית אחרי reboot
    pm2 startup systemd -u ubuntu --hp /home/ubuntu
    sudo -u ubuntu bash -lc "pm2 save"

  CLOUDINIT
  )
}

}

resource "oci_core_instance" "controller_vm" {
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[0].name
  compartment_id      = var.compartment_ocid
  shape               = "VM.Standard.E2.1.Micro" # Free Tier
  display_name        = "Render_Controller"

  source_details {
    source_type = "image"
    source_id   = data.oci_core_images.ubuntu_x86.images[0].id 
  }

  create_vnic_details {
    subnet_id        = oci_core_subnet.render_subnet.id
    assign_public_ip = true
  }

  metadata = {
    ssh_authorized_keys = file(var.ssh_public_key_path)
    
    user_data = base64encode(<<-EOF
      #!/bin/bash

      # 1. הגדרת משתנה הסביבה באופן קבוע במערכת
      echo 'export WORKER_INSTANCE_ID="${oci_core_instance.render_worker.id}"' >> /etc/profile.d/render_vars.sh
      export WORKER_INSTANCE_ID="${oci_core_instance.render_worker.id}"

      # 2. עדכון והתקנת Node.js ו-Git
      apt-get update
      apt-get install -y git
      curl -sL https://deb.nodesource.com/setup_18.x | sudo -E bash -
      apt-get install -y nodejs

      # 3. הורדת הקוד מה-Repo
      cd /home/ubuntu
      git clone https://github.com/Amit18115/AWS1.git controller-backend
      cd controller-backend

      # 4. התקנת תלויות ו-PM2
      npm install
      npm install -g pm2
      
      # 5. שינוי הרשאות ליוזר ubuntu כדי שיוכל להריץ את השרת
      chown -R ubuntu:ubuntu /home/ubuntu/controller-backend

      # 6. הרצת השרת עם המשתנה המוזרק דרך יוזר ubuntu
      # הערה: אנחנו משתמשים ב-sudo -u ubuntu כדי ש-PM2 ירוץ תחת המשתמש הרגיל ולא root
      sudo -u ubuntu bash -c "export WORKER_INSTANCE_ID=${oci_core_instance.render_worker.id}; cd /home/ubuntu/controller-backend; pm2 start index.js --name 'controller-api'"

      echo "Node.js Environment Ready and App Running with Worker ID: ${oci_core_instance.render_worker.id}" > /home/ubuntu/setup_status.txt
    EOF
    )
  }
}