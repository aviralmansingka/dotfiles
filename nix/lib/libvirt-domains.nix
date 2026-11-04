# The nine libvirt domains the homelab runs, declared as data.
#
# The hypervisor stack is root-level and stays with apt (`libvirt-daemon-system`,
# `qemu-system`, `libvirt-dev`): a user profile cannot own a system daemon or
# the kernel modules it needs. The *definitions* are reproducible: each domain's
# inactive XML is dumped by scripts/capture-libvirt-domains.sh to a directory
# outside the repo, and this file records the name, UUID and the dump's sha256.
# A new host rebuilds a domain with `virsh -c qemu:///system define <dump>`.
#
# Do not hand-edit the list: run scripts/capture-libvirt-domains.sh --write-nix
{
  captured = "2026-11-04";
  dumpDirectory = "~/libvirt-dumps/2026-11-04";
  connection = "qemu:///system";

  domains = [
    # BEGIN GENERATED
    { name = "maasvm1"; uuid = "3a4a2c87-b3bb-48ee-af0c-f9b5f2c7b883"; xmlSha256 = "f8e18f6864863df3e7432c083e1d69b15e234e0c20624618f99f419895a978ef"; }
    { name = "maasvm2"; uuid = "852fb256-8424-4605-bb50-ac6235582027"; xmlSha256 = "75932dd29b3c804b9586e42be491bdecb7158984cc3596104eb788aa28d27a95"; }
    { name = "maasvmctl"; uuid = "e29b52a4-0d0e-4813-9c5b-bf22e553c327"; xmlSha256 = "a54e2e63bb337449c8c49f1efb06b6820d94fe38bf09c034e2016a0efb6d71df"; }
    { name = "tbvm1"; uuid = "2a64ee84-ad66-46d5-b670-310ed7af139e"; xmlSha256 = "2086df2ff4ffa4a3e8fbfb2898051f52eb2aedfa2c45a5a64a8d828acc5f0ccf"; }
    { name = "tbvm2"; uuid = "41226186-99fe-4b6c-9296-a9f1eaaadfb9"; xmlSha256 = "58b14d04946a1f042ed06b41aecc75d5507252d48cb197c4803cdf36f8df87df"; }
    { name = "telegram-vm"; uuid = "80e78010-36ce-4e43-9646-d183d4f5cfc5"; xmlSha256 = "d11e38246311ce7525326e7457ecab45b54a61e7b52a36e5796be751c028d767"; }
    { name = "testvm1"; uuid = "2a239d62-40c3-4c93-a867-b609a8aad494"; xmlSha256 = "5d93d9c35f19e5c44adbe78d5f7400ab1f02711f193d98a5dca911768cc830ef"; }
    { name = "testvm2"; uuid = "9c40fd12-84d0-4784-b681-87022328206e"; xmlSha256 = "d1ecf08330d3876ee6571cecce2a06e0f1d617c45735a54f0c956469aa4bc7d5"; }
    { name = "testvm3"; uuid = "fd3f2c11-69c8-4092-92ea-57a217505080"; xmlSha256 = "febe01138928f14395424887680f0b4b247925825aa57dc51ce2295ede3c30cc"; }
    # END GENERATED
  ];
}
