output "controller_public_ip" {
  value = oci_core_instance.controller_vm.public_ip
}

output "worker_private_ip" {
  value = oci_core_instance.render_worker.private_ip
}

output "frontend_bucket_url" {
  value = "https://objectstorage.${var.region}.oraclecloud.com/n/${data.oci_objectstorage_namespace.ns.namespace}/b/${oci_objectstorage_bucket.frontend_bucket.name}/o/index.html"
}
output "worker_ocid" {
  value = oci_core_instance.render_worker.id
}

resource "local_file" "frontend_config" {
  content  = templatefile("${path.module}/assets/config.json.tpl", {
    controller_ip = oci_core_instance.controller_vm.public_ip
    region        = var.region
    namespace     = data.oci_objectstorage_namespace.ns.namespace
  })
  filename = "${path.module}/../frontend/config.json"
}