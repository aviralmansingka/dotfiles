#!/usr/bin/env python3
"""
YAML-based dependency installer for dotfiles
Generates installation commands for different operating systems based on dependencies.yml
"""

import yaml
import sys
import argparse
from typing import Dict, List, Optional

class DependencyInstaller:
    def __init__(self, config_file: str = "dependencies.yml"):
        with open(config_file, 'r') as f:
            self.config = yaml.safe_load(f)
    
    def get_package_name(self, package: str, os_name: str) -> Optional[str]:
        """Get the OS-specific package name, return None if not available"""
        mappings = self.config.get('package_mappings', {}).get(os_name, {})
        return mappings.get(package, package)
    
    def get_packages_for_categories(self, categories: List[str]) -> List[str]:
        """Get all packages for specified categories"""
        packages = []
        for category in categories:
            if category in self.config['categories']:
                packages.extend(self.config['categories'][category]['packages'])
        return packages
    
    def filter_available_packages(self, packages: List[str], os_name: str) -> List[str]:
        """Filter out packages that aren't available on the target OS"""
        available = []
        for package in packages:
            mapped_name = self.get_package_name(package, os_name)
            if mapped_name is not None:
                available.append(mapped_name)
        return available
    
    def get_special_installations(self, os_name: str) -> Dict[str, str]:
        """Get special installation commands for the OS"""
        special = self.config.get('special_installations', {})
        result = {}
        for package, commands in special.items():
            if os_name in commands:
                result[package] = commands[os_name]
        return result
    
    def generate_dockerfile_commands(self, os_name: str, categories: List[str] = None) -> List[str]:
        """Generate Dockerfile RUN commands for the specified OS"""
        if categories is None:
            categories = ['core', 'development', 'tools', 'languages']
        
        commands = []
        packages = self.get_packages_for_categories(categories)
        available_packages = self.filter_available_packages(packages, os_name)
        
        # Add OS-specific additional packages
        additional = self.config.get('os_specific', {}).get(os_name, {}).get('additional', [])
        available_packages.extend(additional)
        
        # Remove duplicates and None values
        available_packages = list(set([p for p in available_packages if p]))
        
        # Generate package manager install command
        if os_name == 'ubuntu':
            if available_packages:
                pkg_list = ' \\\n    '.join(available_packages)
                commands.append(f"""RUN apt-get update && apt-get install -y \\
    {pkg_list} \\
    && apt-get clean \\
    && rm -rf /var/lib/apt/lists/*""")
        
        elif os_name == 'centos':
            # EPEL and CRB setup
            commands.append("""RUN dnf install -y epel-release && \\
    dnf config-manager --set-enabled crb && \\
    dnf update -y""")
            
            if available_packages:
                pkg_list = ' \\\n    '.join(available_packages)
                commands.append(f"""RUN dnf install -y --allowerasing \\
    {pkg_list} \\
    && dnf clean all""")
        
        elif os_name == 'alpine':
            if available_packages:
                pkg_list = ' \\\n    '.join(available_packages)
                commands.append(f"""RUN apk update && apk add --no-cache \\
    {pkg_list}""")
        
        # Add special installations
        special = self.get_special_installations(os_name)
        for package, install_cmd in special.items():
            if install_cmd != "package":  # Skip packages handled by package manager
                commands.append(f"# Install {package}")
                commands.append(f"RUN {install_cmd}")
        
        return commands
    
    def generate_brewfile(self) -> str:
        """Generate Brewfile content from YAML config"""
        lines = []
        
        # Add taps
        for tap in self.config.get('taps', []):
            lines.append(f'tap "{tap}"')
        lines.append('')
        
        # Add all packages
        all_categories = ['core', 'development', 'languages', 'tools', 'cloud', 'java', 'python']
        packages = self.get_packages_for_categories(all_categories)
        
        for package in packages:
            mapped_name = self.get_package_name(package, 'macos')
            if mapped_name:
                lines.append(f'brew "{mapped_name}"')
        
        lines.append('')
        
        # Add casks
        casks = self.config.get('casks', {})
        for category, cask_list in casks.items():
            lines.append(f'# {category.title()}')
            for cask in cask_list:
                lines.append(f'cask "{cask}"')
            lines.append('')
        
        return '\n'.join(lines)
    
    def generate_install_script_deps(self, os_name: str) -> List[str]:
        """Generate dependency installation for install.sh script"""
        commands = []
        
        if os_name == 'macos':
            commands.append("# Install all dependencies from Brewfile")
            commands.append("brew bundle")
        else:
            # For Linux, we'll assume Docker-based installation patterns
            dockerfile_commands = self.generate_dockerfile_commands(os_name)
            # Convert Docker commands to shell script format
            for cmd in dockerfile_commands:
                if cmd.startswith('RUN '):
                    # Remove RUN prefix and line continuations for shell script
                    shell_cmd = cmd[4:].replace(' \\\n    ', ' ').replace(' \\', '')
                    commands.append(shell_cmd)
                elif cmd.startswith('# '):
                    commands.append(cmd)
        
        return commands

def main():
    parser = argparse.ArgumentParser(description='Generate installation commands from dependencies.yml')
    parser.add_argument('--os', choices=['ubuntu', 'centos', 'alpine', 'macos'], 
                       required=True, help='Target operating system')
    parser.add_argument('--format', choices=['dockerfile', 'brewfile', 'script'], 
                       default='dockerfile', help='Output format')
    parser.add_argument('--categories', nargs='+', 
                       choices=['core', 'development', 'languages', 'tools', 'cloud', 'java', 'python'],
                       help='Package categories to include')
    parser.add_argument('--config', default='dependencies.yml', 
                       help='YAML configuration file')
    
    args = parser.parse_args()
    
    try:
        installer = DependencyInstaller(args.config)
        
        if args.format == 'dockerfile':
            commands = installer.generate_dockerfile_commands(args.os, args.categories)
            for cmd in commands:
                print(cmd)
                print()
        
        elif args.format == 'brewfile':
            print(installer.generate_brewfile())
        
        elif args.format == 'script':
            commands = installer.generate_install_script_deps(args.os)
            for cmd in commands:
                print(cmd)
    
    except FileNotFoundError:
        print(f"Error: Configuration file '{args.config}' not found", file=sys.stderr)
        sys.exit(1)
    except yaml.YAMLError as e:
        print(f"Error parsing YAML configuration: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()