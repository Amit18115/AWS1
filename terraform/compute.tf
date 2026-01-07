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