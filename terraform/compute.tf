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

    # הוספתי הגדרת Swap כדי ש-Blender לא יקרוס מיד על 1GB RAM
    user_data = base64encode(<<-EOF
      #!/bin/bash
      # יצירת זיכרון וירטואלי (Swap) של 4GB כדי לעזור לביצועים
      fallocate -l 4G /swapfile
      chmod 600 /swapfile
      mkswap /swapfile
      swapon /swapfile
      echo '/swapfile none swap sw 0 0' >> /etc/fstab

      # עדכון והתקנת Blender
      apt-get update
      apt-get install -y blender
      echo "Installation complete with Swap" > /home/ubuntu/status.txt
    EOF
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
    
    # עדכון ה-Script להתקנת סביבת Node.js ו-OCI SDK
    user_data = base64encode(<<-EOF
      #!/bin/bash
      # 1. עדכון המערכת והתקנת Node.js ו-NPM
      apt-get update
      curl -sL https://deb.nodesource.com/setup_18.x | sudo -E bash -
      apt-get install -y nodejs

      # 2. יצירת תיקיית עבודה לאפליקציה
      mkdir -p /home/ubuntu/controller-backend
      cd /home/ubuntu/controller-backend

      # 3. יצירת קובץ package.json בסיסי
      cat <<EOT > package.json
      {
        "name": "controller-backend",
        "version": "1.0.0",
        "main": "index.js",
        "dependencies": {
          "express": "^4.18.2",
          "oci-common": "^2.73.0",
          "oci-core": "^2.73.0",
          "oci-objectstorage": "^2.73.0"
        }
      }
      EOT

      git clone https://github.com/your-user/your-repo.git /home/ubuntu/controller-backend
      cd /home/ubuntu/controller-backend
      # 4. התקנת התלויות
      npm install
      
      # 5. שינוי הרשאות לתיקייה כדי שמשתמש ubuntu יוכל לעבוד עליה
      chown -R ubuntu:ubuntu /home/ubuntu/controller-backend

      echo "Node.js Environment Ready" > /home/ubuntu/setup_status.txt

    EOF
    )
  }
}