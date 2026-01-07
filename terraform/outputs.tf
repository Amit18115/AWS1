output "controller_public_ip" {
  value = oci_core_instance.controller_vm.public_ip
}

output "worker_private_ip" {
  value = oci_core_instance.render_worker.private_ip
}

output "frontend_bucket_url" {
  value = "https://objectstorage.${var.region}.oraclecloud.com/n/${data.oci_objectstorage_namespace.ns.namespace}/b/${oci_objectstorage_bucket.frontend_bucket.name}/o/index.html"
}