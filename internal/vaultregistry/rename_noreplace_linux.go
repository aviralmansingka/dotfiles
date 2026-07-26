//go:build linux

package vaultregistry

import (
	"runtime"
	"syscall"
	"unsafe"
)

const renameNoReplaceFlag = 1 // RENAME_NOREPLACE

func renameNoReplace(oldPath, newPath string) error {
	oldPointer, err := syscall.BytePtrFromString(oldPath)
	if err != nil {
		return err
	}
	newPointer, err := syscall.BytePtrFromString(newPath)
	if err != nil {
		return err
	}
	atFDCWD := ^uintptr(99) // -100
	systemCall, err := renameat2SystemCall()
	if err != nil {
		return err
	}
	_, _, errno := syscall.Syscall6(
		systemCall,
		atFDCWD,
		uintptr(unsafe.Pointer(oldPointer)),
		atFDCWD,
		uintptr(unsafe.Pointer(newPointer)),
		renameNoReplaceFlag,
		0,
	)
	if errno != 0 {
		return errno
	}
	return nil
}

func renameat2SystemCall() (uintptr, error) {
	switch runtime.GOARCH {
	case "386":
		return 353, nil
	case "amd64":
		return 316, nil
	case "arm":
		return 382, nil
	case "arm64", "loong64", "riscv64":
		return 276, nil
	case "mips", "mipsle":
		return 4351, nil
	case "mips64", "mips64le":
		return 5311, nil
	case "ppc", "ppc64", "ppc64le":
		return 357, nil
	case "s390x":
		return 347, nil
	case "sparc64":
		return 345, nil
	default:
		return 0, syscall.ENOSYS
	}
}
