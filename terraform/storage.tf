# באקט לקבצי קלט (.blend)
resource "oci_objectstorage_bucket" "input_bucket" {
  compartment_id = var.compartment_ocid
  name           = "render_input_bucket"
  namespace      = data.oci_objectstorage_namespace.ns.namespace
  access_type    = "NoPublicAccess"
}

# באקט לקבצי פלט (תמונות מרונדרות)
resource "oci_objectstorage_bucket" "output_bucket" {
  compartment_id = var.compartment_ocid
  name           = "render_output_bucket"
  namespace      = data.oci_objectstorage_namespace.ns.namespace
  access_type    = "NoPublicAccess"
}

# באקט לאתר הסטטי (Frontend)
resource "oci_objectstorage_bucket" "frontend_bucket" {
  compartment_id = var.compartment_ocid
  name           = "render_frontend_bucket"
  namespace      = data.oci_objectstorage_namespace.ns.namespace
  access_type    = "ObjectRead" # מאפשר גישה ציבורית לקריאה
}

data "oci_objectstorage_namespace" "ns" {
  compartment_id = var.compartment_ocid
}