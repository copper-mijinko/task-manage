import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { spawn } from 'child_process';

function electronDevPlugin() {
	return {
		name: 'electron-dev',
		configureServer(server) {
			server.httpServer?.once('listening', () => {
				const electronProcess = spawn('npm', ['run', 'start'], {
					env: { ...process.env, VITE_DEV: 'true' },
					stdio: 'inherit',
					shell: true,
				});
				process.on('exit', () => electronProcess?.kill());
			});
		},
	};
}

export default defineConfig({
	plugins: [svelte(), electronDevPlugin()],
	base: './',
	publicDir: 'public',
	build: {
		outDir: 'dist',
		emptyOutDir: true,
	},
});
