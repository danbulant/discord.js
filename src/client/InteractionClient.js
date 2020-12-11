'use strict';

const BaseClient = require('./BaseClient');
const Interaction = require('../structures/Interaction');
const { ApplicationCommandOptionType, InteractionType, InteractionResponseType } = require('../util/Constants');

let sodium;

/**
 * Interaction client is used for interactions.
 *
 * ```js
 * const client = new InteractionClient({
 *   token: ABC,
 *   publicKey: XYZ,
 * }, async (interaction) => {
 *   // automatically handles long responses
 *   if (will take a long time) {
 *     await doSomethingLong.then((d) => {
 *       interaction.reply({
 *         content: 'wow that took long',
 *       });
 *     });
 *   } else {
 *     await interaction.reply('hi!');
 *   }
 * });
 * ```
 */
class InteractionClient extends BaseClient {
  /**
   * @param {Options} options Options for the client.
   * @param {Handler} handler Handler to handle things.
   * @param {undefined} client For internal use.
   */
  constructor(options, handler, client) {
    super(options);

    this.handler = handler;
    this.token = options.token;
    this.publicKey = options.publicKey ? Buffer.from(options.publicKey, 'hex') : undefined;
    this.clientID = options.clientID;

    // Compat for direct usage
    this.client = client || this;
    this.interactionClient = this;
  }

  getCommands(guildID) {
    let path = this.client.api.applications('@me');
    if (guildID) {
      path = path.guilds(guildID);
    }
    return path.commands.get();
  }

  createCommand(command, guildID) {
    let path = this.client.api.applications('@me');
    if (guildID) {
      path = path.guilds(guildID);
    }
    return path.commands.post({
      data: {
        name: command.name,
        description: command.description,
        options: command.options.map(function m(o) {
          return {
            type: ApplicationCommandOptionType[o.type],
            name: o.name,
            description: o.description,
            default: o.default,
            required: o.required,
            choices: o.choices,
            options: o.options.map(m),
          };
        }),
      },
    });
  }

  deleteCommand(commandID, guildID) {
    let path = this.client.api.applications('@me');
    if (guildID) {
      path = path.guilds(guildID);
    }
    return path.commands(commandID).delete();
  }

  async handle(data) {
    switch (data.type) {
      case InteractionType.PING:
        return {
          type: InteractionResponseType.PONG,
        };
      case InteractionType.APPLICATION_COMMAND: {
        let timedOut = false;
        let resolve;
        const p0 = new Promise(r => {
          resolve = r;
          this.client.setTimeout(() => {
            timedOut = true;
            r({
              type: InteractionResponseType.ACKNOWLEDGE_WITH_SOURCE,
            });
          }, 500);
        });

        const interaction = new Interaction(this.client, data, resolved => {
          if (timedOut) {
            return false;
          }
          resolve({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: resolved.data,
          });
          return true;
        });

        Promise.resolve(this.handler(interaction)).catch(e => {
          this.client.emit('error', e);
        });

        const result = await p0;

        return result;
      }
      default:
        throw new RangeError('Invalid interaction data');
    }
  }

  middleware() {
    return async (req, res, next) => {
      const timestamp = req.get('x-signature-timestamp');
      const signature = req.get('x-signature-ed25519');

      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);

      if (sodium === undefined) {
        sodium = require('../util/Sodium');
      }
      if (
        !sodium.methods.verify(
          Buffer.from(signature, 'hex'),
          Buffer.concat([Buffer.from(timestamp), body]),
          this.publicKey,
        )
      ) {
        res.status(403).end();
        return;
      }

      const data = JSON.parse(body.toString());

      const result = await this.handle(data);
      res.status(200).end(JSON.stringify(result));

      next();
    };
  }

  async handleFromGateway(data) {
    const result = await this.handle(data);

    await this.client.api.interactions(data.id, data.token).callback.post({
      data: result,
    });
  }
}

module.exports = InteractionClient;
