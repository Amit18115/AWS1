terraform {
  required_providers {
    oci = {
      source  = "oracle/oci"
      version = ">= 5.0.0"
    }
  }
}
provider "oci" {
  tenancy_ocid     = "ocid1.tenancy.oc1..aaaaaaaax7etnfqnplxrbx3tedhpeuvkz4xvqkm5c5asdd4qmzgka3qtem7q"
  user_ocid        = "ocid1.user.oc1..aaaaaaaay2zl2w52jpta33c7mlyc5mqzhqpaam4tpzanfppt4sazuuywljbq"
  fingerprint      = "4f:3b:93:a2:d9:eb:59:57:81:f0:c0:f2:bb:9a:38:99"
  private_key_path = "C:/Users/shash/OneDrive/Desktop/college/aws/shashamit3@gmail.com-2026-01-04T14_26_29.508Z.pem"
  region           = "il-jerusalem-1"
}