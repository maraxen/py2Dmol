# py2Dmol

<<<<<<< HEAD
[![Build status][github-actions-shield]][github-actions-link]
[![Coverage status][coverage-shield]][coverage-link]
[![Open in Colab][colab-shield]][colab-link]

A Python library for visualizing protein, DNA, and RNA structures in 2D, designed for use in Google Colab and Jupyter environments.

```html
<img src="https://github.com/user-attachments/assets/5f043fa8-99d6-4988-aaa1-68d1bc48660b" width="300"/>
<img src="https://github.com/user-attachments/assets/3b52d584-1d7e-45cc-a620-77377f0a0c01" width="300"/>
```

## Installation

```bash
uv pip install py2Dmol
```

or for cutting edge releases

```bash
uv pip install git+https://github.com/sokrypton/py2Dmol
```

## Usage

Here are a few examples of how to use py2Dmol.

### Initializing the Viewer

You can initialize the viewer with several options:

```python
import py2dmol

# Default viewer
viewer = py2dmol.view()

# Customized viewer
viewer = py2dmol.view(
    size=(600, 600),   # Set canvas size (width, height)
    color='chain',     # Set initial color mode
    shadow=True,       # Enable shadows by default
    outline=True,      # Enable outlines by default
    width=3.0,         # Set initial line width
    rotate=False       # Disable auto-rotation by default
)
```

### Loading a Structure from a PDB or CIF File

You can load a structure directly from a PDB or CIF file using the `from_pdb` method. This will automatically extract:

- **C-alpha atoms** for proteins
- **C4' atoms** for DNA and RNA
- **All heavy atoms** for ligands

If the file contains multiple models, they will be loaded as an animation.

```python
import py2dmol
viewer = py2dmol.view()
viewer.add_pdb('my_protein.pdb')
```

You can also specify which chains to display:

```python
viewer.add_pdb('my_protein.pdb', chains=['A', 'B'])
```

### Manually Adding Data

You can also add data to the viewer using the `add` method. This is useful for visualizing custom trajectories or molecular data.

```python
import numpy as np

def generate_alpha_helix_on_superhelix(n_residues=50, super_radius=0, super_turns=0):
    """
    Generate alpha helix wrapped around a cylinder (superhelix).

    Parameters:
    - n_residues: number of residues
    - super_radius: radius of the superhelix (0 = straight helix)
    - super_turns: number of superhelical turns
    """
    coords = []
    helix_radius = 2.3  # Å from helix axis to CA
    rise_per_residue = 1.5  # Å along helix axis
    rotation_per_residue = 100 * np.pi / 180  # 100 degrees

    helix_length = (n_residues - 1) * rise_per_residue

    for i in range(n_residues):
        # Alpha helix coordinates
        helix_angle = i * rotation_per_residue
        local_x = helix_radius * np.cos(helix_angle)
        local_y = helix_radius * np.sin(helix_angle)
        z = i * rise_per_residue

        if super_radius == 0:
            # Straight helix
            x, y = local_x, local_y
        else:
            # Wrap around superhelix
            super_angle = (z / helix_length) * 2 * np.pi * super_turns

            # Transform: local helix coordinates → superhelix
            x = (super_radius + local_x) * np.cos(super_angle) - local_y * np.sin(super_angle)
            y = (super_radius + local_x) * np.sin(super_angle) + local_y * np.cos(super_angle)

        coords.append([x, y, z])

    return np.array(coords)

# Create initial straight helix
coords = generate_alpha_helix_on_superhelix(100, super_radius=0, super_turns=0)
plddts = np.linspace(50, 95, 100)
chains = ['A'] * 100
atom_types = ['P'] * 100

# Display
viewer = py2dmol.view()

# Animate: gradually add superhelical twist
# Wrapping around a larger cylinder with increasing turns
for frame in range(1, 21):
    super_radius = 10.0  # Radius of the "pole"
    super_turns = frame * 0.075  # Gradually increase from 0 to 1.5 turns
    twisted_coords = generate_alpha_helix_on_superhelix(
        100, super_radius=super_radius, super_turns=super_turns
    )
    viewer.add(twisted_coords, plddts, chains, atom_types)
```

### Mixed Structure Example

You can create custom visualizations with multiple molecule types:

```python
import numpy as np

def generate_alpha_helix(n_residues, offset=np.array([0, 0, 0])):
    """Generate ideal alpha helix (CA-CA ~3.8 Å)."""
    coords = []
    radius = 2.3
    rise_per_residue = 1.5
    rotation_per_residue = 100 * np.pi / 180

    for i in range(n_residues):
        angle = i * rotation_per_residue
        x = radius * np.cos(angle) + offset[0]
        y = radius * np.sin(angle) + offset[1]
        z = i * rise_per_residue + offset[2]
        coords.append([x, y, z])
    return np.array(coords)

def generate_dna_strand(n_bases, offset=np.array([0, 0, 0])):
    """Generate B-DNA backbone (C4'-C4' ~7.0 Å)."""
    coords = []
    radius = 10.0  # Distance from helix axis to C4'
    rise_per_base = 3.4  # B-DNA rise
    rotation_per_base = 36 * np.pi / 180  # 10 bases per turn

    for i in range(n_bases):
        angle = i * rotation_per_base
        x = radius * np.cos(angle) + offset[0]
        y = radius * np.sin(angle) + offset[1]
        z = i * rise_per_base + offset[2]
        coords.append([x, y, z])
    return np.array(coords)

def generate_benzene_ring(center):
    """Generate benzene-like small molecule (C-C 1.4 Å)."""
    coords = []
    bond_length = 1.4
    for i in range(6):
        angle = i * np.pi / 3  # 60 degrees between carbons
        x = center[0] + bond_length * np.cos(angle)
        y = center[1] + bond_length * np.sin(angle)
        z = center[2]
        coords.append([x, y, z])
    return np.array(coords)

# Create protein helix
protein_coords = generate_alpha_helix(50, offset=np.array([15, 0, 0]))
protein_plddts = np.full(50, 90.0)
protein_chains = ['A'] * 50
protein_types = ['P'] * 50

# Create DNA strand
dna_coords = generate_dna_strand(30, offset=np.array([-15, 0, 0]))
dna_plddts = np.full(30, 85.0)
dna_chains = ['B'] * 30
dna_types = ['D'] * 30

# Add a small molecule ligand
ligand_coords = generate_benzene_ring(center=np.array([0, 0, 40]))
ligand_plddts = np.full(6, 70.0)
ligand_chains = ['L'] * 6
ligand_types = ['L'] * 6

# Combine all components
all_coords = np.vstack([protein_coords, dna_coords, ligand_coords])
all_plddts = np.concatenate([protein_plddts, ligand_plddts, ligand_plddts])
all_chains = protein_chains + dna_chains + ligand_chains
all_types = protein_types + dna_types + ligand_types

viewer = py2dmol.view(
    color='chain',
    size=(600, 600),
    width=2.5,
    outline=False
)
viewer.add(all_coords, all_plddts, all_chains, all_types)
```

## Atom Types and Representative Atoms

| Molecule Type | Atom Type Code | Representative Atom | Purpose |
|---------------|----------------|---------------------|---------|
| Protein | P | CA (C-alpha) | Backbone trace |
| DNA | D | C4' (sugar carbon) | Backbone trace |
| RNA | R | C4' (sugar carbon) | Backbone trace |
| Ligand | L | All heavy atoms | Full structure |

## Distance Thresholds

The viewer uses different distance thresholds for creating bonds:

- Protein (CA-CA): 5.0 Å
- DNA/RNA (C4'-C4'): 7.5 Å
- Ligand bonds: 2.0 Å

These thresholds are optimized for their respective molecular structures and ensure proper connectivity visualization.

## Chains

Chains are automatically extracted from the PDB or CIF file. When loading a structure, you can choose to display all chains or specify a subset of chains to visualize.

## Color Modes

The viewer supports multiple coloring schemes:

- **auto** (default): Automatically chooses 'chain' if multiple chains are present, otherwise 'rainbow'.
- **rainbow**: Colors atoms sequentially from N-terminus to C-terminus (or 5' to 3' for nucleic acids)
- **plddt**: Colors based on B-factor/pLDDT scores (useful for AlphaFold predictions)
- **chain**: Each chain receives a distinct color

```python
# Use pLDDT coloring
viewer = py2dmol.view(color='plddt')
viewer.add_pdb('alphafold_prediction.pdb')

# Use chain coloring
viewer = py2dmol.view(color='chain')
viewer.add_pdb('multi_chain_complex.pdb')
```

## Features

- Interactive 3D-style visualization with rotation and zoom
- Animation support for trajectories and multiple models
- Automatic structure detection for proteins, DNA, and RNA
- Multiple color schemes (auto, rainbow, pLDDT, chain)
- Ligand visualization with automatic bond detection
- Toggleable effects for depth perception (shadow, outline)
- Adjustable line width
- Real-time auto-rotation (toggleable)
- Trajectory management for comparing multiple simulations

## Supported File Formats

- PDB (.pdb)
- mmCIF (.cif)

Both formats support multi-model files for animation playback.

## Examples

### Comparing Multiple Trajectories

```python
# Load first trajectory
viewer = py2dmol.view()
viewer.add_pdb('simulation1.pdb')

# Start a new trajectory
viewer.add_pdb('simulation2.pdb', new_traj=True)

# Use the dropdown to switch between trajectories
```

## Requirements

- Python 3.9+
- NumPy
- gemmi (for PDB/CIF parsing)
- IPython (for display in notebooks)

[github-actions-shield]: https://github.com/maraxen/py2Dmol/actions/workflows/ci.yml/badge.svg
[github-actions-link]: https://github.com/maraxen/py2Dmol/actions/workflows/ci.yml
[coverage-shield]: https://codecov.io/gh/maraxen/py2Dmol/branch/main/graph/badge.svg
[coverage-link]: https://codecov.io/gh/maraxen/py2Dmol
[colab-shield]: https://colab.research.google.com/assets/colab-badge.svg
[colab-link]: https://colab.research.google.com/github/maraxen/py2Dmol/blob/main/example/example.ipynb
=======
A Python library for visualizing protein, DNA, and RNA structures in 2D, designed for Google Colab and Jupyter.

<img width="535" height="344" alt="image" src="https://github.com/user-attachments/assets/81fb0b9e-32a5-4fc7-ac28-921cf52f696e" />

Bonus: [online interactive version](http://py2dmol.solab.org/)
<a href="https://colab.research.google.com/github/sokrypton/py2Dmol/blob/main/py2Dmol_demo.ipynb" target="_parent"><img src="https://colab.research.google.com/assets/colab-badge.svg" alt="Open In Colab"/></a>

## Installation
```bash
pip install py2Dmol
```
### latest experimental
```bash
pip install git+https://github.com/sokrypton/py2Dmol.git
```

## Quickstart: core workflow
`py2Dmol` has two modes—decided by when you call `show()`:
- **Static**: `add*()` then `show()` → one self-contained viewer.
- **Live**: `show()` then `add*()` → stream frames/points as you go.

### Load a PDB (static)
```python
import py2Dmol
viewer = py2Dmol.view()
viewer.add_pdb('6MRR')
viewer.show()
```

### Load a PDB (live)
#### cell #1
```python
import py2Dmol
viewer = py2Dmol.view()
viewer.show()
```
#### cell #2
```python
viewer.add_pdb('6MRR')
```

### Helpful loading shortcuts
```python
py2Dmol.view(autoplay=True).from_pdb('1YNE')                        # ensemble
py2Dmol.view(rotate=True).from_pdb('1BJP', use_biounit=True)        # biounit
py2Dmol.view().from_pdb('9D2J')                                     # multi-chain
py2Dmol.view(pae=True).from_afdb('Q5VSL9')                          # AlphaFold + pAE
```

### Basic viewer options
```python
viewer = py2Dmol.view(
    size=(300, 300), color='auto', colorblind=False,
    shadow=True, outline='full', width=3.0, ortho=1.0,
    rotate=False, autoplay=False, box=True, controls=True,
)
viewer.add_pdb("my_complex.cif")
viewer.show()
```

## Layouts & multiple objects

### Compare trajectories
```python
viewer = py2Dmol.view()
viewer.add_pdb('simulation1.pdb', name="sim1")
viewer.add_pdb('simulation2.pdb', name="sim2")  # creates a new object
viewer.show()  # switch via dropdown
```

### Grid gallery
```python
with py2Dmol.grid(cols=2, size=(300, 300)) as g:
    g.view().from_pdb('1YNE')
    g.view().from_pdb('1BJP')
    g.view().from_pdb('9D2J')
    g.view().from_pdb('2BEG')
```

## Scatter plot
Visualize per-frame 2D data (RMSD vs energy, PCA, etc.) synced to the trajectory. Scatter highlights the current frame and is clickable to jump frames.

```python
# Trajectory with scatter points
viewer = py2Dmol.view(scatter=True, scatter_size=300)
viewer.add_pdb(
    "trajectory.pdb",
    scatter=trajectory_scatter_points,  # list/array of [x, y] per frame (or path to CSV with x,y; first row used as labels if present)
    scatter_config={"xlabel": "RMSD (Å)", "ylabel": "Energy (kcal/mol)", "xlim": [0, 10], "ylim": [-150, -90]},
)
viewer.show()
```

**CSV with trajectory**
```python
viewer = py2Dmol.view(scatter=True)
viewer.add_pdb('trajectory.pdb', scatter='data.csv')  # header used to set axis labels
viewer.show()
```

**Data sources**
- Array/list: per-frame `scatter=[x, y]` (list/tuple/dict) or a 2-column array with one row per frame.
- CSV file: two numeric columns; optional header row sets `xlabel`, `ylabel`. Example:
  ```
  RMSD,Energy
  1.2,-150.3
  1.4,-149.8
  1.6,-149.1
  ```

# Advanced

## Contact restraints
Contacts are colored lines between residues; width follows weight.

**File formats (`.cst`)**
- `idx1 idx2 weight [color]` (0-based)
- `chain1 res1 chain2 res2 weight [color]`

**Data sources**
- Array/list: list/array of `[idx1, idx2, weight]` or `[idx1, idx2, weight, {r,g,b}]` (0-based indices).
- File: `.cst` text file, one contact per line (formats above).

**Add contacts**
```python
viewer = py2Dmol.view()
viewer.add_pdb('structure.pdb', contacts='contacts.cst')
viewer.show()
```

## Colors
Rendering uses a fixed 25% white mix to soften colors (DeepMind palette remains unlightened); there is no user-facing pastel/lightening setting.
Five-level priority: Global (`view(color=...)`) < Object < Frame < Chain < Position.

Semantic modes: `auto`, `chain`, `plddt`, `rainbow`, `entropy`, `deepmind`
Literal: named, hex, or `{"r":255,"g":0,"b":0}`

**How to target colors**
- Position: `set_color("red", position=10)` or `position=(start, end)`
- Chain: `set_color("red", chain="A")`
- Frame: `add(..., color="rainbow")` on a single frame
- Object: `set_color({"type": "mode", "value": "plddt"}, name="obj1")`
- Global: `view(color="chain")`

```python
viewer = py2Dmol.view(color="plddt")
viewer.add_pdb("protein.pdb")
viewer.set_color("red", chain="A")
viewer.set_color("yellow", position=(0, 20))
viewer.set_color("red", chain="A", position=10, frame=0)
viewer.show()
```

# Super Advanced

## custom `add()` payloads
Build mixed systems (protein/DNA/ligand) with explicit atom types.
```python
import numpy as np, py2Dmol
def helix(n, radius=2.3, rise=1.5, rotation=100):
    angles = np.radians(rotation) * np.arange(n)
    return np.column_stack([radius*np.cos(angles), radius*np.sin(angles), rise*np.arange(n)])

protein = helix(50); protein[:,0] += 15
dna = helix(30, radius=10, rise=3.4, rotation=36); dna[:,0] -= 15
angles = np.linspace(0, 2*np.pi, 6, endpoint=False)
ligand = np.column_stack([1.4*np.cos(angles), 1.4*np.sin(angles), np.full(6, 40)])

coords = np.vstack([protein, dna, ligand])
plddts = np.concatenate([np.full(50, 90), np.full(30, 85), np.full(6, 70)])
chains = ['A']*50 + ['B']*30 + ['L']*6
types = ['P']*50 + ['D']*30 + ['L']*6

viewer = py2Dmol.view((400,300), rotate=True)
viewer.add(coords, plddts, chains, types)
viewer.show()
```

## Live mode wiggle
```python
import numpy as np
viewer = py2Dmol.view(autoplay=True)
viewer.show()
angles = np.linspace(0, 2 * np.pi, 20, endpoint=False)
for frame in range(60):
    coords = np.column_stack([
        4 * np.sin(2 * angles + frame * 4 * np.pi/60),
        12 * np.cos(angles + frame * np.pi/60),
        12 * np.sin(angles + frame * np.pi/60)
    ])
    viewer.add(coords)
```

## Saving and loading
Save or restore full viewer state (structures, settings, MSA, contacts, frame/object selection).
```python
viewer = py2Dmol.view(size=(600, 600), shadow=True)
viewer.add_pdb('protein.pdb'); viewer.show()
viewer.save_state('my_visualization.json')

viewer2 = py2Dmol.view()
viewer2.load_state('my_visualization.json')
viewer2.show()
```



## Super Advanced

### `replace()`


```python
viewer = py2Dmol.view()
viewer.show()
viewer.add(coords1)  # Cell #1
viewer.add(coords2)  # Cell #2
viewer.replace(coords3)  # Updates Cell #2, replaces last frame
```

### `persistence`

Control output cell behavior with the `persistence` parameter:
- `viewer.view(persistence=True)`: Default - Building trajectories, want visible history
- `viewer.view(persistence=False)`: Animations, temporary viz, avoid notebook bloat

## Reference
**Atom codes**: Protein=P (CA), DNA=D (C4'), RNA=R (C4'), Ligand=L (heavy atoms)
**Bond thresholds**: Protein CA-CA 5.0 Å; DNA/RNA C4'-C4' 7.5 Å; Ligand 2.0 Å
**Color modes**: `auto`, `rainbow`, `plddt`, `chain`
**Outline modes**: `none`, `partial`, `full` (default)
**Formats**: PDB (.pdb), mmCIF (.cif); multi-model files load as frames.
>>>>>>> 4d590025ffa708ca40041e9b0dc8508fa2c41233
