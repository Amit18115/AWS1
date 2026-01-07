# קבוצה דינמית הכוללת את שרת ה-Controller
resource "oci_identity_dynamic_group" "controller_group" {
  compartment_id = var.tenancy_ocid
  description    = "Group for the Controller VM"
  name           = "ControllerDynamicGroup"
  matching_rule  = "ALL {instance.id = '${oci_core_instance.controller_vm.id}'}"
}

# מדיניות הרשאות
resource "oci_identity_policy" "controller_policy" {
  compartment_id = var.compartment_ocid
  description    = "Policy for Controller to manage workers and storage"
  name           = "ControllerPolicy"
  statements = [
    "Allow dynamic-group ControllerDynamicGroup to manage instances in compartment id ${var.compartment_ocid}",
    "Allow dynamic-group ControllerDynamicGroup to manage objects in compartment id ${var.compartment_ocid}"
  ]
}