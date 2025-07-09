const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function checkFileExists(filename) {
  return fs.existsSync(path.join(process.cwd(), filename));
}

function readFileJSON(filename) {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), filename), 'utf8'));
}

function checkPostCSSConfig() {
  const configPath = path.join(process.cwd(), 'postcss.config.js');
  if (!fs.existsSync(configPath)) {
    console.warn('❌ postcss.config.js not found.');
    return false;
  }

  const configContent = fs.readFileSync(configPath, 'utf8');
  const hasTailwind = configContent.includes('tailwindcss');
  const hasAutoprefixer = configContent.includes('autoprefixer');

  if (hasTailwind && hasAutoprefixer) {
    console.log('✅ postcss.config.js includes TailwindCSS and Autoprefixer.');
    return true;
  } else {
    console.warn('❌ postcss.config.js missing TailwindCSS or Autoprefixer.');
    return false;
  }
}

function checkTailwindConfig() {
  if (!checkFileExists('tailwind.config.js')) {
    console.warn('❌ tailwind.config.js not found.');
    return false;
  }
  const configContent = fs.readFileSync('tailwind.config.js', 'utf8');
  if (configContent.length < 10) {
    console.warn('❌ tailwind.config.js seems too short or empty.');
    return false;
  }

  console.log('✅ tailwind.config.js found and has content.');
  return true;
}

function checkViteConfig() {
  if (!checkFileExists('vite.config.js')) {
    console.warn('❌ vite.config.js not found.');
    return false;
  }

  const content = fs.readFileSync('vite.config.js', 'utf8');
  const hasPostCSS = content.includes('postcss') || content.includes('tailwindcss');
  const usesPlugins = content.includes('plugins');

  if (hasPostCSS && usesPlugins) {
    console.log('✅ vite.config.js includes plugin setup and TailwindCSS references.');
    return true;
  } else {
    console.warn('❌ vite.config.js may be missing TailwindCSS or plugin setup.');
    return false;
  }
}

function checkVersions() {
  try {
    const pkg = readFileJSON('package.json');
    const deps = Object.assign({}, pkg.dependencies, pkg.devDependencies);

    const tailwind = deps['tailwindcss'];
    const postcss = deps['postcss'];
    const vite = deps['vite'];

    if (tailwind && postcss && vite) {
      console.log(`📦 Installed versions:
      - tailwindcss: ${tailwind}
      - postcss: ${postcss}
      - vite: ${vite}`);

      const isCompat =
        parseInt(postcss.split('.')[0]) >= 8 &&
        parseInt(vite.split('.')[0]) >= 3 &&
        parseInt(tailwind.split('.')[0]) >= 3;

      if (isCompat) {
        console.log('✅ Versions look compatible with PostCSS 8 and Vite.');
        return true;
      } else {
        console.warn('⚠️ Consider upgrading: Tailwind ≥3, PostCSS ≥8, Vite ≥3 recommended.');
        return false;
      }
    } else {
      console.warn('❌ Missing required dependencies (tailwindcss, postcss, vite) in package.json.');
      return false;
    }
  } catch (err) {
    console.error('Error reading package.json:', err.message);
    return false;
  }
}

function runCheck() {
  console.log('\n🔍 Verifying Tailwind + PostCSS + Vite setup...\n');
  const checks = [
    checkPostCSSConfig(),
    checkTailwindConfig(),
    checkViteConfig(),
    checkVersions()
  ];

  if (checks.every(Boolean)) {
    console.log('\n✅ All checks passed. Your setup is compatible!\n');
  } else {
    console.warn('\n⚠️ Some issues detected. Please review the messages above.\n');
  }
}

runCheck();
