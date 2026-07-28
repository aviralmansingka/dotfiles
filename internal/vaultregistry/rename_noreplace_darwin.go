//go:build darwin

package vaultregistry

import (
	"syscall"
	"unsafe"
)

const (
	sysRenameatxNP = 488 // SYS_renameatx_np
	renameExcl     = 0x4 // RENAME_EXCL
)

func renameNoReplace(oldPath, newPath string) error {
	oldPointer, err := syscall.BytePtrFromString(oldPath)
	if err != nil {
		return err
	}
	newPointer, err := syscall.BytePtrFromString(newPath)
	if err != nil {
		return err
	}
	atFDCWD := ^uintptr(1) // -2
	_, _, errno := syscall.Syscall6(
		sysRenameatxNP,
		atFDCWD,
		uintptr(unsafe.Pointer(oldPointer)),
		atFDCWD,
		uintptr(unsafe.Pointer(newPointer)),
		renameExcl,
		0,
	)
	if errno != 0 {
		return errno
	}
	return nil
}
