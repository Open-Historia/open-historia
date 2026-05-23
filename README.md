<h1 align="center">Pax Historia</h1>

<div align="center">
  <strong>An open-source, community-driven alternative to <a href="https://www.paxhistoria.co/games">Pax Historia</a>.</strong>
</div>

<br />

<div align="center">
  <!-- Discord -->
  <a href="https://discord.gg/C3AVwHacZ4">
    <img src="https://img.shields.io/badge/discord-join-5865F2.svg?style=flat-square&logo=discord&logoColor=white"
      alt="Discord" />
  </a>
  <!-- License -->
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square"
      alt="License: MIT" />
  </a>
  <!-- Status -->
  <a href="#">
    <img src="https://img.shields.io/badge/status-early%20development-orange.svg?style=flat-square"
      alt="Early Development" />
  </a>
</div>

<div align="center">
  <sub>Built with ❤︎ by <a href="https://github.com/Tommi-K">Tommi-K</a> and <a href="https://github.com/Tommi-K/pax-historia/graphs/contributors">contributors</a></sub>
</div>

<br />
<br />

![](https://github.com/Tommi-K/pax-historia/blob/main/public/screenshot.png?raw=true)

---

## ✨ Features

- __interactive world map:__ watch territory, borders, and nations shift as history unfolds
- __ai-generated events:__ dynamic events shaped by your decisions and the state of the world
- __diplomacy:__ negotiate with AI-controlled nations through natural language chat
- __ai advisor:__ consult your advisor for strategic guidance, economic analysis, and situation summaries
- __scenarios:__ choose from a range of historical starting points and play as any nation
- __self-hostable:__ run your own instance with your own AI backend completely offline

---

## 🚀 Installation

### Prerequisites

- [Git](https://git-scm.com/)
- [Node.js](https://nodejs.org/en)

### Steps

```bash
git clone https://github.com/Tommi-K/pax-historia.git
cd pax-historia
git lfs install        # Set up Git LFS
git lfs pull           # Pull large files
npm install            # Install dependencies
npm run build          # Build the server
node server/server.js  # Start the server
```

Then open **http://localhost:3000** in your browser.
