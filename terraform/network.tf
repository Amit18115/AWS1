# 1. יצירת ה-VCN (הרשת הראשית)
resource "oci_core_vcn" "render_vcn" {
  cidr_block     = "10.0.0.0/16"
  compartment_id = var.compartment_ocid
  display_name   = "render_vcn"
  dns_label      = "rendervcn"
}

# 2. יצירת Internet Gateway (כדי שתהיה גישה לאינטרנט)
resource "oci_core_internet_gateway" "render_ig" {
  compartment_id = var.compartment_ocid
  display_name   = "render_internet_gateway"
  vcn_id         = oci_core_vcn.render_vcn.id
}

# 3. הגדרת טבלת ניתוב (Route Table)
resource "oci_core_default_route_table" "render_route_table" {
  manage_default_resource_id = oci_core_vcn.render_vcn.default_route_table_id
  display_name               = "render_route_table"

  route_rules {
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
    network_entity_id = oci_core_internet_gateway.render_ig.id
  }
}

# 4. הגדרת אבטחה (Security List) - פתיחת פורט 22 ל-SSH
resource "oci_core_default_security_list" "render_security_list" {
  manage_default_resource_id = oci_core_vcn.render_vcn.default_security_list_id
  display_name               = "render_security_list"

  ingress_security_rules {
    protocol = "6" # TCP
    source   = "0.0.0.0/0"
    tcp_options {
      min = 22
      max = 22
    }
  }
  ingress_security_rules {
      protocol = "6" # TCP
      source   = "0.0.0.0/0"
      tcp_options {
        min = 80
        max = 80
      }
  }
  egress_security_rules {
    protocol    = "all"
    destination = "0.0.0.0/0"
  }

  
}


# 5. יצירת Subnet (תת-רשת) בתוך ה-VCN
resource "oci_core_subnet" "render_subnet" {
  cidr_block        = "10.0.1.0/24"
  display_name      = "render_subnet"
  dns_label         = "rendersubnet"
  compartment_id    = var.compartment_ocid
  vcn_id            = oci_core_vcn.render_vcn.id
  route_table_id    = oci_core_default_route_table.render_route_table.id
  security_list_ids = [oci_core_default_security_list.render_security_list.id]
}