# Claude Colors Reference

A collection of colors associated with Claude AI and Claude Code for consistent theming.

## Official Claude Brand Colors

### Primary Colors
| Color Name | Hex Code | RGB Values | Usage |
|------------|----------|------------|--------|
| Terra Cotta | `#da7756` | (218, 119, 86) | Primary brand color, used in logo |
| Crail | `#C15F3C` | (193, 95, 60) | Alternative warm accent |
| Black | `#000000` | (0, 0, 0) | Text and contrast |

### Secondary Colors
| Color Name | Hex Code | RGB Values | Usage |
|------------|----------|------------|--------|
| Cloudy | `#B1ADA1` | (177, 173, 161) | Neutral/muted accent |
| Pampas | `#F4F3EE` | (244, 243, 238) | Light background |
| White | `#FFFFFF` | (255, 255, 255) | Pure backgrounds |

## Color Usage in Dotfiles

### Claude Code Configuration
- **Border Color**: `#da7756` (Terra Cotta)
  - Used in `lazyvim/.config/nvim/lua/plugins/claude-code.lua`
  - Applied to `ClaudeCodeBorder` highlight group
  - Provides visual identity matching Claude branding

### Implementation Notes
- Terra cotta (`#da7756`) used for Claude Code terminal borders
- Maintains consistency with Claude's warm, engaging brand identity
- Complements GruvboxDark theme while providing Claude-specific highlighting

### CSS/Styling Examples
```css
/* Claude primary color */
.claude-primary { color: #da7756; }

/* Claude secondary colors */
.claude-neutral { color: #B1ADA1; }
.claude-light-bg { background-color: #F4F3EE; }
.claude-accent { color: #C15F3C; }
```

### Color Accessibility
- Terra cotta (`#da7756`) provides good contrast against dark backgrounds
- Consider accessibility when using these colors for text elements
- Test contrast ratios for WCAG compliance when needed

## References
- Claude brand identity and official color palette
- Color hex codes sourced from Claude AI branding documentation
- Applied in Neovim configuration for consistent theming