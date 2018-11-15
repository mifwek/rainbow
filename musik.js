const { Client, Util } = require('discord.js');
const { TOKEN, PREFIX, GOOGLE_API_KEY } = require('./config');
const YouTube = require('simple-youtube-api');
const ytdl = require('ytdl-core');

const client = new Client({ disableEveryone: true });

const youtube = new YouTube(GOOGLE_API_KEY);

const queue = new Map();

client.on('warn', console.warn);

client.on('error', console.error);

client.on('ready', () => console.log('Yo this ready!'));

client.on('disconnect', () => console.log('I just disconnected, making sure you know, I will reconnect now...'));

client.on('reconnecting', () => console.log('I am reconnecting now!'));

client.on('message', async msg => { // eslint-disable-line
	if (msg.author.bot) return undefined;
	if (!msg.content.startsWith(PREFIX)) return undefined;

	const args = msg.content.split(' ');
	const searchString = args.slice(1).join(' ');
	const url = args[1] ? args[1].replace(/<(.+)>/g, '$1') : '';
	const serverQueue = queue.get(msg.guild.id);

	let command = msg.content.toLowerCase().split(' ')[0];
	command = command.slice(PREFIX.length)

	if (command === 'play') {
		const voiceChannel = msg.member.voiceChannel;
		if (!voiceChannel) return msg.channel.send('```Saya minta maaf, tetapi Kamu harus berada di saluran suara untuk memutar musik!```');
		const permissions = voiceChannel.permissionsFor(msg.client.user);
		if (!permissions.has('CONNECT')) {
			return msg.channel.send('```Saya tidak dapat terhubung ke saluran suara Kamu, pastikan saya memiliki izin yang tepat!```');
		}
		if (!permissions.has('SPEAK')) {
			return msg.channel.send('```Saya tidak dapat berbicara di saluran suara ini, pastikan saya memiliki izin yang tepat!```');
		}

		if (url.match(/^https?:\/\/(www.youtube.com|youtube.com)\/playlist(.*)$/)) {
			const playlist = await youtube.getPlaylist(url);
			const videos = await playlist.getVideos();
			for (const video of Object.values(videos)) {
				const video2 = await youtube.getVideoByID(video.id); // eslint-disable-line no-await-in-loop
				await handleVideo(video2, msg, voiceChannel, true); // eslint-disable-line no-await-in-loop
			}
			return msg.channel.send(`✅ Daftar Putar: **${playlist.title}** telah ditambahkan ke antrean!`);
		} else {
			try {
				var video = await youtube.getVideo(url);
			} catch (error) {
				try {
					var videos = await youtube.searchVideos(searchString, 10);
					let index = 0;
					msg.channel.send(`
__**Pemilihan lagu:**__
\n
${videos.map(video2 => `**${++index} -** ${video2.title}`).join('\n')}
\n
Harap berikan nilai untuk memilih salah satu hasil pencarian mulai dari 1-10.
					`);
					// eslint-disable-next-line max-depth
					try {
						var response = await msg.channel.awaitMessages(msg2 => msg2.content > 0 && msg2.content < 11, {
							maxMatches: 1,
							time: 30000,
							errors: ['time']
						});
					} catch (err) {
						console.error(err);
						return msg.channel.send('```Nilai yang dimasukkan tidak valid, membatalkan pemilihan video.```');
					}
					const videoIndex = parseInt(response.first().content);
					var video = await youtube.getVideoByID(videos[videoIndex - 1].id);
				} catch (err) {
					console.error(err);
					return msg.channel.send('```🆘 Saya tidak dapat memperoleh hasil pencarian apa pun.```');
				}
			}
			return handleVideo(video, msg, voiceChannel);
		}
	} else if (command === 'skip') {
		if (!msg.member.voiceChannel) return msg.channel.send('```Kamu tidak berada dalam saluran suara!```');
		if (!serverQueue) return msg.channel.send('```Tidak ada permainan yang bisa saya lewati untuk Kamu.```');
		serverQueue.connection.dispatcher.end
		return msg.channel.send('```Perintah lewati telah digunakan```');
	} else if (command === 'leave') {
		if (!msg.member.voiceChannel) return msg.channel.send('```Kamu tidak berada dalam saluran suara!```');
		if (!serverQueue) return msg.channel.send('```Tidak ada permainan yang bisa saya hentikan untuk Kamu.```');
		serverQueue.songs = [];
		serverQueue.connection.dispatcher.end
		return msg.channel.send('```Perintah leave telah digunakan```');
	} else if (command === 'volume') {
		if (!msg.member.voiceChannel) return msg.channel.send('```Kamu tidak berada dalam saluran suara!```');
		if (!serverQueue) return msg.channel.send('```Tidak ada yang bermain.```');
		if (!args[1]) return msg.channel.send(`Volume saat ini: **${serverQueue.volume}**`);
		serverQueue.volume = args[1];
		serverQueue.connection.dispatcher.setVolumeLogarithmic(args[1] / 4);
		return msg.channel.send(`Saya mengatur volume ke: **${args[1]}**`);
	} else if (command === 'np') {
		if (!serverQueue) return msg.channel.send('Tidak ada yang bermain.');
		return msg.channel.send(`🎶 Sedang dimainkan: **${serverQueue.songs[0].title}**`);
	} else if (command === 'queue') {
		if (!serverQueue) return msg.channel.send('```Tidak ada yang bermain.```');
		return msg.channel.send(`
__**Antrean lagu:**__
\n
${serverQueue.songs.map(song => `**-** ${song.title}`).join('\n')}
\n
**Sedang dimainkan:** ${serverQueue.songs[0].title}
		`);
	} else if (command === 'pause') {
		if (serverQueue && serverQueue.playing) {
			serverQueue.playing = false;
			serverQueue.connection.dispatcher.pause();
			return msg.channel.send('```⏸ Menjeda musik untuk Kamu!```');
		}
		return msg.channel.send('```Tidak ada yang bermain.```');
	} else if (command === 'resume') {
		if (serverQueue && !serverQueue.playing) {
			serverQueue.playing = true;
			serverQueue.connection.dispatcher.resume();
			return msg.channel.send('```▶ Melanjutkan musik untuk Kamu!```');
		}
		return msg.channel.send('```Tidak ada yang bermain.```');
	}

	return undefined;
});

async function handleVideo(video, msg, voiceChannel, playlist = false) {
	const serverQueue = queue.get(msg.guild.id);
	console.log(video);
	const song = {
		id: video.id,
		title: Util.escapeMarkdown(video.title),
		url: `https://www.youtube.com/watch?v=${video.id}`
	};
	if (!serverQueue) {
		const queueConstruct = {
			textChannel: msg.channel,
			voiceChannel: voiceChannel,
			connection: null,
			songs: [],
			volume: 4,
			playing: true
		};
		queue.set(msg.guild.id, queueConstruct);

		queueConstruct.songs.push(song);

		try {
			var connection = await voiceChannel.join();
			queueConstruct.connection = connection;
			play(msg.guild, queueConstruct.songs[0]);
		} catch (error) {
			console.error(`Saya tidak dapat bergabung dengan saluran suara: ${error}`);
			queue.delete(msg.guild.id);
			return msg.channel.send(`Saya tidak dapat bergabung dengan saluran suara: ${error}`);
		}
	} else {
		serverQueue.songs.push(song);
		console.log(serverQueue.songs);
		if (playlist) return undefined;
		else return msg.channel.send(`✅ **${song.title}** telah ditambahkan ke antrean!`);
	}
	return undefined;
}

function play(guild, song) {
	const serverQueue = queue.get(guild.id);

	if (!song) {
		serverQueue.voiceChannel.leave();
		queue.delete(guild.id);
		return;
	}
	console.log(serverQueue.songs);

	const dispatcher = serverQueue.connection.playStream(ytdl(song.url))
		.on('end', reason => {
			if (reason === '```Streaming tidak menghasilkan cukup cepat.```') console.log('```Lagu telah selesai.```');
			else console.log(reason);
			serverQueue.songs.shift();
			play(guild, serverQueue.songs[0]);
		})
		.on('error', error => console.error(error));
	dispatcher.setVolumeLogarithmic(serverQueue.volume / 5);

	serverQueue.textChannel.send(`🎶 Mulai bermain: **${song.title}**`);
}

client.login(TOKEN);
