#!/usr/bin/env python3
"""
Dependency installer script for dotfiles repository.
Processes dependencies.json to generate platform-specific installation commands.
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Dict, List, Set, Optional


class DependencyProcessor:
    def __init__(self, deps_file: str = "dependencies.json"):
        self.deps_file = Path(deps_file)
        self.config = self._load_config()

    def _load_config(self) -> Dict:
        """Load and parse dependencies.json configuration."""
        if not self.deps_file.exists():
            raise FileNotFoundError(f"Dependencies file not found: {self.deps_file}")

        with open(self.deps_file, 'r') as f:
            return json.load(f)

    def _get_all_packages(self) -> Set[str]:
        """Get all packages from all categories."""
        packages = set()
        for category in self.config.get('categories', {}).values():
            packages.update(category.get('packages', []))
        return packages

    def _map_package_name(self, package: str, os_name: str) -> Optional[str]:
        """Map package name to OS-specific name."""
        mappings = self.config.get('package_mappings', {}).get(os_name, {})

        # If package has explicit mapping
        if package in mappings:
            mapped_name = mappings[package]
            # If mapped to null, package is not available/needed on this OS
            if mapped_name is None:
                return None
            return mapped_name

        # If no explicit mapping exists, use original name
        return package

    def _get_additional_packages(self, os_name: str) -> List[str]:
        """Get OS-specific additional packages."""
        return self.config.get('os_specific', {}).get(os_name, {}).get('additional', [])

    def _get_special_installations(self, os_name: str) -> Dict[str, str]:
        """Get packages that need special installation methods."""
        special = {}
        for package, methods in self.config.get('special_installations', {}).items():
            if os_name in methods and methods[os_name] != "package":
                special[package] = methods[os_name]
        return special

    def generate_package_list(self, os_name: str) -> tuple[List[str], List[str], Dict[str, str]]:
        """Generate package lists for the specified OS."""
        all_packages = self._get_all_packages()
        regular_packages = []
        unavailable_packages = []

        # Process regular packages
        for package in sorted(all_packages):
            mapped_name = self._map_package_name(package, os_name)
            if mapped_name is None:
                unavailable_packages.append(package)
            else:
                regular_packages.append(mapped_name)

        # Add OS-specific additional packages
        additional_packages = self._get_additional_packages(os_name)
        regular_packages.extend(additional_packages)

        # Remove duplicates while preserving order
        regular_packages = list(dict.fromkeys(regular_packages))

        # Get special installations
        special_installations = self._get_special_installations(os_name)

        return regular_packages, unavailable_packages, special_installations

    def generate_dockerfile(self, os_name: str) -> str:
        """Generate Dockerfile commands for the specified OS."""
        regular_packages, unavailable, special = self.generate_package_list(os_name)

        lines = []
        lines.append(f"# Dependencies for {os_name}")
        lines.append("")

        if os_name == "ubuntu":
            lines.append("RUN apt-get update && apt-get install -y \\")
            for package in regular_packages[:-1]:
                lines.append(f"    {package} \\")
            if regular_packages:
                lines.append(f"    {regular_packages[-1]} \\")
            lines.append("    && apt-get clean && rm -rf /var/lib/apt/lists/*")

        elif os_name == "alpine":
            lines.append("RUN apk add --no-cache \\")
            for package in regular_packages[:-1]:
                lines.append(f"    {package} \\")
            if regular_packages:
                lines.append(f"    {regular_packages[-1]}")

        else:
            raise ValueError(f"Unsupported OS: {os_name}")

        # Add special installations
        if special:
            lines.append("")
            lines.append("# Special installations")
            for package, command in special.items():
                lines.append(f"# Install {package}")
                lines.append(f"RUN {command}")

        # Add note about unavailable packages
        if unavailable:
            lines.append("")
            lines.append(f"# Note: The following packages are not available on {os_name}:")
            for package in unavailable:
                lines.append(f"# - {package}")

        return "\n".join(lines)

    def generate_brewfile(self) -> str:
        """Generate Brewfile content."""
        lines = []

        # Add regular packages
        all_packages = self._get_all_packages()
        for package in sorted(all_packages):
            mapped_name = self._map_package_name(package, 'macos')
            if mapped_name:  # Skip packages mapped to null
                lines.append(f'brew "{mapped_name}"')

        # Add casks
        casks = self.config.get('casks', {})
        if casks:
            lines.append("")
            for category, cask_list in casks.items():
                lines.append(f"# {category.title()}")
                for cask in cask_list:
                    lines.append(f'cask "{cask}"')
                lines.append("")

        return "\n".join(lines)

    def generate_install_script(self, os_name: str) -> str:
        """Generate installation script for the specified OS."""
        regular_packages, unavailable, special = self.generate_package_list(os_name)

        lines = []
        lines.append("#!/bin/bash")
        lines.append(f"# Auto-generated dependency installation script for {os_name}")
        lines.append("set -e")
        lines.append("")

        if os_name == "ubuntu":
            lines.append("echo 'Updating package lists...'")
            lines.append("sudo apt-get update")
            lines.append("")
            lines.append("echo 'Installing packages...'")
            packages_str = " ".join(regular_packages)
            lines.append(f"sudo apt-get install -y {packages_str}")

        elif os_name == "alpine":
            lines.append("echo 'Installing packages...'")
            packages_str = " ".join(regular_packages)
            lines.append(f"sudo apk add --no-cache {packages_str}")

        else:
            raise ValueError(f"Unsupported OS: {os_name}")

        # Add special installations
        if special:
            lines.append("")
            lines.append("echo 'Installing packages with special methods...'")
            for package, command in special.items():
                lines.append(f"echo 'Installing {package}...'")
                lines.append(command)

        if unavailable:
            lines.append("")
            lines.append("echo 'Note: The following packages are not available and were skipped:'")
            for package in unavailable:
                lines.append(f"echo '  - {package}'")

        lines.append("")
        lines.append("echo 'Installation complete!'")

        return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Process dependencies.yml for different platforms")
    parser.add_argument("--os", required=True, choices=["ubuntu", "alpine", "macos"],
                       help="Target operating system")
    parser.add_argument("--format", required=True,
                       choices=["dockerfile", "brewfile", "script", "list"],
                       help="Output format")
    parser.add_argument("--deps-file", default="dependencies.json",
                       help="Path to dependencies.json file")

    args = parser.parse_args()

    try:
        processor = DependencyProcessor(args.deps_file)

        if args.format == "dockerfile":
            if args.os == "macos":
                print("Error: Dockerfile format not supported for macOS", file=sys.stderr)
                sys.exit(1)
            print(processor.generate_dockerfile(args.os))

        elif args.format == "brewfile":
            print(processor.generate_brewfile())

        elif args.format == "script":
            if args.os == "macos":
                print("Error: Script format not supported for macOS (use Brewfile)", file=sys.stderr)
                sys.exit(1)
            print(processor.generate_install_script(args.os))

        elif args.format == "list":
            regular, unavailable, special = processor.generate_package_list(args.os)
            print(f"Regular packages ({len(regular)}):")
            for pkg in regular:
                print(f"  {pkg}")
            if unavailable:
                print(f"\nUnavailable packages ({len(unavailable)}):")
                for pkg in unavailable:
                    print(f"  {pkg}")
            if special:
                print(f"\nSpecial installations ({len(special)}):")
                for pkg in special:
                    print(f"  {pkg}")

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()