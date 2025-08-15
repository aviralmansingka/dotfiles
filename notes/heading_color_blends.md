# Gruvbox-Material Heading Color Blends

## Base Colors and Blended Backgrounds

**Base Background:** `#282828` (GruvboxDark)

| Level | Color Name | Text Color | 15% Blend | 30% Blend |
|-------|------------|------------|-----------|-----------|
| H1 | Red | `#f2594b` | `#341e1c` | `#402620` |
| H2 | Orange | `#f28534` | `#331e1a` | `#3e2619` |
| H3 | Yellow | `#e9b143` | `#311f19` | `#3a251a` |
| H4 | Green | `#b0b846` | `#2c2a1a` | `#352e17` |
| H5 | Blue | `#80aa9e` | `#2a302f` | `#2e3938` |
| H6 | Purple | `#d3869b` | `#301d25` | `#382029` |

## Color Calculation Details

**Blend Formula:** `new_color = (base × (1 - ratio)) + (text_color × ratio)`

### 15% Blend Calculations:
- H1: `#282828` + 15% of `#f2594b` = `#341e1c`
- H2: `#282828` + 15% of `#f28534` = `#331e1a`
- H3: `#282828` + 15% of `#e9b143` = `#311f19`
- H4: `#282828` + 15% of `#b0b846` = `#2c2a1a`
- H5: `#282828` + 15% of `#80aa9e` = `#2a302f`
- H6: `#282828` + 15% of `#d3869b` = `#301d25`

### 30% Blend Calculations:
- H1: `#282828` + 30% of `#f2594b` = `#402620`
- H2: `#282828` + 30% of `#f28534` = `#3e2619`
- H3: `#282828` + 30% of `#e9b143` = `#3a251a`
- H4: `#282828` + 30% of `#b0b846` = `#352e17`
- H5: `#282828` + 30% of `#80aa9e` = `#2e3938`
- H6: `#282828` + 30% of `#d3869b` = `#382029`

## Usage Recommendations

- **15% blend**: Subtle highlight effect, good for minimal distraction
- **30% blend**: More prominent highlighting, better visibility

## Implementation Notes

These colors follow the gruvbox-material heading color progression:
**Red → Orange → Yellow → Green → Blue → Purple**

The blend calculations ensure that background colors remain readable while providing visual hierarchy through color temperature and intensity variations.