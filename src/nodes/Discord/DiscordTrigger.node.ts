import {
	Client,
	GatewayIntentBits,
	Partials,
	Message,
	GuildBasedChannel,
} from 'discord.js';

import {
	INodeType,
	INodeTypeDescription,
	ITriggerFunctions,
	ITriggerResponse,
	IWebhookFunctions,
	IWebhookResponseData,
	ILoadOptionsFunctions,
} from 'n8n-workflow';

export class DiscordTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Discord Trigger',
		name: 'discordTrigger',
		icon: 'file:discord.svg',
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["event"]}}',
		description: 'Starts the workflow when Discord events occur',
		defaults: {
			name: 'Discord Trigger',
		},
		inputs: [],
		outputs: [{ type: 'main' }],
		credentials: [
			{
				name: 'discordBotApi',
				required: true,
			},
		],
		webhooks: [
			{
				name: 'setup',
				httpMethod: 'GET',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName: 'Event',
				name: 'event',
				type: 'options',
				options: [
					{
						name: 'Message Created',
						value: 'messageCreated',
						description: 'Triggered when a message is created',
					},
				],
				default: 'messageCreated',
				required: true,
			},
			{
				displayName: 'Channel',
				name: 'channelId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getChannels',
				},
				default: '',
				required: true,
				description: 'Select the channel to listen to',
			},
			{
				displayName: 'Only Messages from Bot',
				name: 'onlyBot',
				type: 'boolean',
				default: false,
			},
			{
				displayName: 'Bot ID',
				name: 'botId',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						onlyBot: [true],
					},
				},
			},
		],
	};

	methods = {
		loadOptions: {
			async getChannels(this: ILoadOptionsFunctions) {
				const credentials = await this.getCredentials('discordBotApi');
				const token = credentials.token as string;

				const client = new Client({
					intents: [
						GatewayIntentBits.Guilds,
						GatewayIntentBits.GuildMessages,
					],
				});

				await client.login(token);
				const guilds = await client.guilds.fetch();
				const options: { name: string; value: string }[] = [];

				for (const [, guildPreview] of guilds) {
					const guild = await guildPreview.fetch();
					const channels = await guild.channels.fetch();

					for (const [, channel] of channels) {
						if (
							channel &&
							channel.isTextBased?.() &&
							(channel as GuildBasedChannel).name
						) {
							options.push({
								name: `${guild.name} / ${(channel as GuildBasedChannel).name}`,
								value: channel.id,
							});
						}
					}
				}

				await client.destroy();
				return options;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const webhookName = this.getWebhookName();
		if (webhookName === 'setup') {
			return { webhookResponse: 'Discord Trigger setup successful!' };
		}
		return { webhookResponse: 'Unknown webhook' };
	}

	async trigger(this: ITriggerFunctions): Promise<ITriggerResponse> {
		const credentials = await this.getCredentials('discordBotApi');
		const token = credentials.token as string;
		const event = this.getNodeParameter('event') as string;
		const channelId = this.getNodeParameter('channelId') as string;
		const onlyBot = this.getNodeParameter('onlyBot') as boolean;
		const botId = this.getNodeParameter('botId', '') as string;

		const client = new Client({
			intents: [
				GatewayIntentBits.Guilds,
				GatewayIntentBits.GuildMessages,
				GatewayIntentBits.MessageContent,
			],
			partials: [Partials.Channel],
		});

		const workflowStaticData = this.getWorkflowStaticData('global');
		const clientKey = `discordClient-${this.getNode().name}`;
		workflowStaticData[clientKey] = client;

		const messageHandler = async (message: Message) => {
			if (message.channelId !== channelId) return;
			if (onlyBot && !message.author.bot) return;
			if (onlyBot && botId && message.author.id !== botId) return;

			const returnData = {
				messageId: message.id,
				content: message.content,
				author: {
					id: message.author.id,
					username: message.author.username,
					bot: message.author.bot,
				},
				channelId: message.channelId,
				guildId: message.guildId,
				createdTimestamp: message.createdTimestamp,
				attachments: [...message.attachments.values()].map((attachment) => ({
					id: attachment.id,
					url: attachment.url,
					name: attachment.name,
					contentType: attachment.contentType,
					size: attachment.size,
				})),
			};

			this.emit([this.helpers.returnJsonArray([returnData])]);
		};

		if (event === 'messageCreated') {
			client.on('messageCreate', messageHandler);
		}

		await client.login(token);

		const manualTriggerFunction = async () => {
			client.removeAllListeners();
			client.destroy();
			delete workflowStaticData[clientKey];
		};

		return { manualTriggerFunction };
	}
}
