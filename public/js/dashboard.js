const formatBytes = (bytes) => {
	if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
	return `${(bytes / (1024 ** index)).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
};

const formatUptime = (seconds) => {
	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	return `${days}d ${hours}h ${minutes}m`;
};

const setMeter = (name, percentage) => {
	const value = Math.max(0, Math.min(100, percentage));
	document.getElementById(`${name}-value`).textContent = Math.round(value);
	document.getElementById(`${name}-meter`).style.width = `${value}%`;
};

async function updateDashboard() {
	const connection = document.querySelector('.connection');
	const label = document.getElementById('connection-label');

	try {
		const response = await fetch('/api/stats', { cache: 'no-store' });
		if (!response.ok) throw new Error(`Stats request failed: ${response.status}`);
		const stats = await response.json();

		connection.classList.remove('offline');
		label.textContent = 'Live';
		document.getElementById('hostname').textContent = stats.system.hostname;
		document.getElementById('platform').textContent = stats.system.platform;
		document.getElementById('node-version').textContent = stats.system.nodeVersion;
		document.getElementById('load-average').textContent = stats.cpu.load.toFixed(2);
		document.getElementById('uptime-value').textContent = formatUptime(stats.system.uptime);
		document.getElementById('cpu-detail').textContent = `${stats.cpu.cores} logical cores · load ${stats.cpu.load.toFixed(2)}`;
		document.getElementById('memory-detail').textContent = `${formatBytes(stats.memory.used)} of ${formatBytes(stats.memory.total)} used`;
		document.getElementById('storage-detail').textContent = `${formatBytes(stats.storage.used)} of ${formatBytes(stats.storage.total)} used`;
		document.getElementById('updated-at').textContent = new Date(stats.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
		setMeter('cpu', stats.cpu.usage);
		setMeter('memory', stats.memory.total ? stats.memory.used / stats.memory.total * 100 : 0);
		setMeter('storage', stats.storage.total ? stats.storage.used / stats.storage.total * 100 : 0);
	} catch (error) {
		connection.classList.add('offline');
		label.textContent = 'Offline';
		console.error('Unable to update server dashboard:', error);
	}
}

document.getElementById('current-date').textContent = new Intl.DateTimeFormat(undefined, {
	weekday: 'short', month: 'short', day: 'numeric'
}).format(new Date()).toUpperCase();

updateDashboard();
setInterval(updateDashboard, 2500);
