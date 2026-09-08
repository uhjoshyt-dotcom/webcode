require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
  PermissionFlagsBits,
  REST,
  Routes
} = require("discord.js");

const { Pool } = require("pg");

/* =========================================================
   DATABASE
========================================================= */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false
});

async function setupDatabase() {

  await pool.query(`
    CREATE TABLE IF NOT EXISTS appeals (
      id SERIAL PRIMARY KEY,
      discord_id TEXT NOT NULL,
      username TEXT NOT NULL,
      reason TEXT NOT NULL,
      explanation TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      reviewed_at TIMESTAMPTZ,
      reviewer_id TEXT,
      discord_message_id TEXT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS applications (
      id SERIAL PRIMARY KEY,
      discord_id TEXT NOT NULL,
      username TEXT NOT NULL,
      score INTEGER NOT NULL,
      total INTEGER NOT NULL,
      passed BOOLEAN NOT NULL,
      answers JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      notified BOOLEAN DEFAULT FALSE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS warnings (
      id SERIAL PRIMARY KEY,
      discord_id TEXT NOT NULL,
      moderator_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS network_bans (
      discord_id TEXT PRIMARY KEY,
      moderator_id TEXT,
      reason TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  console.log("Database ready.");
}

/* =========================================================
   CLIENT
========================================================= */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration
  ]
});

/* =========================================================
   COMMANDS
========================================================= */

const commands = [

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription(
      "Ban someone from ALL Infinity servers."
    )
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("User to ban")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("reason")
        .setDescription("Reason for the ban")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.BanMembers
    ),

  new SlashCommandBuilder()
    .setName("unban")
    .setDescription(
      "Unban someone from ALL Infinity servers."
    )
    .addStringOption(option =>
      option
        .setName("userid")
        .setDescription("Discord user ID")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.BanMembers
    ),

  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kick a member.")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("User to kick")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("reason")
        .setDescription("Reason")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.KickMembers
    ),

  new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Timeout a member.")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("User to timeout")
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName("minutes")
        .setDescription("Timeout length")
        .setMinValue(1)
        .setMaxValue(40320)
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("reason")
        .setDescription("Reason")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ModerateMembers
    ),

  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Warn a member.")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("User to warn")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("reason")
        .setDescription("Reason")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ModerateMembers
    ),

  new SlashCommandBuilder()
    .setName("warnings")
    .setDescription("View a user's warnings.")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("User")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ModerateMembers
    ),

  new SlashCommandBuilder()
    .setName("purge")
    .setDescription("Delete messages.")
    .addIntegerOption(option =>
      option
        .setName("amount")
        .setDescription("Number of messages")
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(true)
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageMessages
    ),

  new SlashCommandBuilder()
    .setName("modhelp")
    .setDescription(
      "Shows Infinity moderation commands."
    )

].map(command => command.toJSON());

/* =========================================================
   REGISTER COMMANDS
========================================================= */

async function registerCommands() {

  const rest = new REST({
    version: "10"
  }).setToken(process.env.DISCORD_TOKEN);

  await rest.put(
    Routes.applicationCommands(
      process.env.DISCORD_CLIENT_ID
    ),
    {
      body: commands
    }
  );

  console.log("Slash commands registered.");
}

/* =========================================================
   EMBED
========================================================= */

function moderationEmbed(title) {

  return new EmbedBuilder()
    .setColor(0x7657ff)
    .setTitle(`♾️ ${title}`)
    .setFooter({
      text:
        "Infinity Entertainment Inc. • Moderation"
    })
    .setTimestamp();
}

/* =========================================================
   GLOBAL BAN
========================================================= */

async function globalBan(
  userId,
  reason,
  moderatorId
) {

  await pool.query(
    `
    INSERT INTO network_bans
    (
      discord_id,
      moderator_id,
      reason
    )

    VALUES ($1,$2,$3)

    ON CONFLICT (discord_id)
    DO UPDATE SET
      moderator_id = EXCLUDED.moderator_id,
      reason = EXCLUDED.reason,
      created_at = NOW()
    `,
    [
      userId,
      moderatorId,
      reason
    ]
  );

  let success = 0;
  let failed = 0;

  for (
    const guild
    of client.guilds.cache.values()
  ) {

    try {

      await guild.members.ban(
        userId,
        {
          reason:
            `Infinity Network Ban | ${reason}`
        }
      );

      success++;

    } catch (error) {

      console.error(
        `Could not ban in ${guild.name}:`,
        error.message
      );

      failed++;

    }
  }

  return {
    success,
    failed
  };
}

/* =========================================================
   GLOBAL UNBAN
========================================================= */

async function globalUnban(userId) {

  await pool.query(
    `
    DELETE FROM network_bans
    WHERE discord_id = $1
    `,
    [userId]
  );

  let success = 0;

  for (
    const guild
    of client.guilds.cache.values()
  ) {

    try {

      await guild.bans.remove(
        userId,
        "Infinity Network Unban"
      );

      success++;

    } catch {
      // User may not be banned in that server.
    }
  }

  return success;
}

/* =========================================================
   SYNC BANS WHEN BOT JOINS NEW SERVER
========================================================= */

async function syncNetworkBans(guild) {

  const bans = await pool.query(
    `
    SELECT *
    FROM network_bans
    `
  );

  for (const ban of bans.rows) {

    try {

      await guild.members.ban(
        ban.discord_id,
        {
          reason:
            `Infinity Network Ban | ${ban.reason}`
        }
      );

    } catch (error) {

      console.error(
        `Ban sync failed: ${ban.discord_id}`
      );

    }
  }
}

client.on(
  "guildCreate",
  async guild => {

    console.log(
      `Joined ${guild.name}. Syncing bans...`
    );

    await syncNetworkBans(guild);
  }
);

/* =========================================================
   COMMAND HANDLER
========================================================= */

client.on(
  "interactionCreate",
  async interaction => {

    /* -------------------------------
       BUTTONS
    -------------------------------- */

    if (interaction.isButton()) {

      if (
        !interaction.customId.startsWith(
          "appeal_"
        )
      ) {
        return;
      }

      if (
        !interaction.memberPermissions?.has(
          PermissionFlagsBits.BanMembers
        )
      ) {

        return interaction.reply({
          content:
            "You do not have permission to review appeals.",
          ephemeral: true
        });
      }

      const [
        type,
        action,
        appealId
      ] = interaction.customId.split("_");

      const result = await pool.query(
        `
        SELECT *
        FROM appeals
        WHERE id = $1
        `,
        [appealId]
      );

      if (!result.rows.length) {

        return interaction.reply({
          content:
            "That appeal no longer exists.",
          ephemeral: true
        });
      }

      const appeal = result.rows[0];

      if (appeal.status !== "pending") {

        return interaction.reply({
          content:
            "This appeal was already reviewed.",
          ephemeral: true
        });
      }

      if (action === "accept") {

        await globalUnban(
          appeal.discord_id
        );

        await pool.query(
          `
          UPDATE appeals

          SET
            status = 'accepted',
            reviewed_at = NOW(),
            reviewer_id = $1

          WHERE id = $2
          `,
          [
            interaction.user.id,
            appeal.id
          ]
        );

        try {

          const user =
            await client.users.fetch(
              appeal.discord_id
            );

          await user.send({
            embeds: [
              moderationEmbed(
                "Ban Appeal Accepted"
              )

              .setColor(0x57f287)

              .setDescription(
                "Your ban appeal for **Infinity Entertainment Inc.** has been accepted."
              )

              .addFields({
                name: "Result",
                value:
                  "You have been unbanned from the Infinity community."
              })
            ]
          });

        } catch {}

        const updated =
          moderationEmbed(
            "Appeal Accepted ✅"
          )

          .setColor(0x57f287)

          .addFields(
            {
              name: "Applicant",
              value:
                `<@${appeal.discord_id}>`
            },

            {
              name: "Reviewed By",
              value:
                `<@${interaction.user.id}>`
            }
          );

        await interaction.update({
          embeds: [updated],
          components: []
        });

      }

      if (action === "deny") {

        await pool.query(
          `
          UPDATE appeals

          SET
            status = 'denied',
            reviewed_at = NOW(),
            reviewer_id = $1

          WHERE id = $2
          `,
          [
            interaction.user.id,
            appeal.id
          ]
        );

        try {

          const user =
            await client.users.fetch(
              appeal.discord_id
            );

          await user.send({
            embeds: [
              moderationEmbed(
                "Ban Appeal Denied"
              )

              .setColor(0xed4245)

              .setDescription(
                "Your ban appeal for **Infinity Entertainment Inc.** was denied."
              )
            ]
          });

        } catch {}

        const updated =
          moderationEmbed(
            "Appeal Denied ❌"
          )

          .setColor(0xed4245)

          .addFields(
            {
              name: "Applicant",
              value:
                `<@${appeal.discord_id}>`
            },

            {
              name: "Reviewed By",
              value:
                `<@${interaction.user.id}>`
            }
          );

        await interaction.update({
          embeds: [updated],
          components: []
        });
      }

      return;
    }

    /* -------------------------------
       SLASH COMMANDS
    -------------------------------- */

    if (!interaction.isChatInputCommand()) {
      return;
    }

    try {

      /* BAN */

      if (
        interaction.commandName === "ban"
      ) {

        await interaction.deferReply();

        const user =
          interaction.options.getUser(
            "user"
          );

        const reason =
          interaction.options.getString(
            "reason"
          );

        if (
          user.id === interaction.user.id
        ) {

          return interaction.editReply(
            "You cannot ban yourself."
          );
        }

        if (user.id === client.user.id) {

          return interaction.editReply(
            "Nice try 😂"
          );
        }

        const result =
          await globalBan(
            user.id,
            reason,
            interaction.user.id
          );

        const embed =
          moderationEmbed(
            "Infinity Network Ban"
          )

          .setColor(0xed4245)

          .setThumbnail(
            user.displayAvatarURL({
              size: 256
            })
          )

          .addFields(
            {
              name: "User",
              value:
                `${user} (${user.id})`
            },

            {
              name: "Moderator",
              value:
                `${interaction.user}`
            },

            {
              name: "Reason",
              value: reason
            },

            {
              name:
                "Infinity Servers",
              value:
                `✅ ${result.success} successful\n❌ ${result.failed} failed`
            }
          );

        await interaction.editReply({
          embeds: [embed]
        });

        try {

          await user.send({
            embeds: [
              moderationEmbed(
                "You Were Banned"
              )

              .setColor(0xed4245)

              .setDescription(
                "You have been banned from the **Infinity Entertainment Inc. community.**"
              )

              .addFields({
                name: "Reason",
                value: reason
              })
            ]
          });

        } catch {}

        return;
      }

      /* UNBAN */

      if (
        interaction.commandName ===
        "unban"
      ) {

        const userId =
          interaction.options.getString(
            "userid"
          );

        await interaction.deferReply();

        const count =
          await globalUnban(userId);

        const embed =
          moderationEmbed(
            "Infinity Network Unban"
          )

          .setColor(0x57f287)

          .addFields(
            {
              name: "User ID",
              value: userId
            },

            {
              name: "Moderator",
              value:
                `${interaction.user}`
            },

            {
              name: "Servers Updated",
              value: `${count}`
            }
          );

        return interaction.editReply({
          embeds: [embed]
        });
      }

      /* KICK */

      if (
        interaction.commandName ===
        "kick"
      ) {

        const user =
          interaction.options.getUser(
            "user"
          );

        const reason =
          interaction.options.getString(
            "reason"
          );

        const member =
          await interaction.guild.members.fetch(
            user.id
          );

        if (!member.kickable) {

          return interaction.reply({
            content:
              "I cannot kick that user.",
            ephemeral: true
          });
        }

        await member.kick(reason);

        return interaction.reply({
          embeds: [
            moderationEmbed(
              "Member Kicked"
            )

            .addFields(
              {
                name: "User",
                value:
                  `${user} (${user.id})`
              },

              {
                name: "Reason",
                value: reason
              },

              {
                name: "Moderator",
                value:
                  `${interaction.user}`
              }
            )
          ]
        });
      }

      /* TIMEOUT */

      if (
        interaction.commandName ===
        "timeout"
      ) {

        const user =
          interaction.options.getUser(
            "user"
          );

        const minutes =
          interaction.options.getInteger(
            "minutes"
          );

        const reason =
          interaction.options.getString(
            "reason"
          );

        const member =
          await interaction.guild.members.fetch(
            user.id
          );

        if (!member.moderatable) {

          return interaction.reply({
            content:
              "I cannot timeout that user.",
            ephemeral: true
          });
        }

        await member.timeout(
          minutes * 60 * 1000,
          reason
        );

        return interaction.reply({
          embeds: [
            moderationEmbed(
              "Member Timed Out"
            )

            .addFields(
              {
                name: "User",
                value: `${user}`
              },

              {
                name: "Length",
                value:
                  `${minutes} minutes`
              },

              {
                name: "Reason",
                value: reason
              },

              {
                name: "Moderator",
                value:
                  `${interaction.user}`
              }
            )
          ]
        });
      }

      /* WARN */

      if (
        interaction.commandName ===
        "warn"
      ) {

        const user =
          interaction.options.getUser(
            "user"
          );

        const reason =
          interaction.options.getString(
            "reason"
          );

        await pool.query(
          `
          INSERT INTO warnings
          (
            discord_id,
            moderator_id,
            guild_id,
            reason
          )

          VALUES ($1,$2,$3,$4)
          `,
          [
            user.id,
            interaction.user.id,
            interaction.guild.id,
            reason
          ]
        );

        const embed =
          moderationEmbed(
            "Member Warned"
          )

          .setColor(0xfee75c)

          .addFields(
            {
              name: "User",
              value: `${user}`
            },

            {
              name: "Reason",
              value: reason
            },

            {
              name: "Moderator",
              value:
                `${interaction.user}`
            }
          );

        await interaction.reply({
          embeds: [embed]
        });

        try {

          await user.send({
            embeds: [
              moderationEmbed(
                "Infinity Warning"
              )

              .setColor(0xfee75c)

              .addFields({
                name: "Reason",
                value: reason
              })
            ]
          });

        } catch {}

        return;
      }

      /* WARNINGS */

      if (
        interaction.commandName ===
        "warnings"
      ) {

        const user =
          interaction.options.getUser(
            "user"
          );

        const result =
          await pool.query(
            `
            SELECT *
            FROM warnings
            WHERE discord_id = $1
            ORDER BY created_at DESC
            LIMIT 10
            `,
            [user.id]
          );

        if (!result.rows.length) {

          return interaction.reply({
            content:
              `${user} has no warnings.`,
            ephemeral: true
          });
        }

        const list =
          result.rows
            .map(
              (warning, index) =>
                `**${index + 1}.** ${warning.reason}\nModerator: <@${warning.moderator_id}>`
            )
            .join("\n\n");

        return interaction.reply({
          embeds: [
            moderationEmbed(
              `Warnings • ${user.username}`
            )

            .setDescription(list)
          ],
          ephemeral: true
        });
      }

      /* PURGE */

      if (
        interaction.commandName ===
        "purge"
      ) {

        const amount =
          interaction.options.getInteger(
            "amount"
          );

        const deleted =
          await interaction.channel.bulkDelete(
            amount,
            true
          );

        return interaction.reply({
          content:
            `🧹 Deleted **${deleted.size}** messages.`,
          ephemeral: true
        });
      }

      /* MOD HELP */

      if (
        interaction.commandName ===
        "modhelp"
      ) {

        const embed =
          moderationEmbed(
            "Moderation Commands"
          )

          .setDescription(
`
**/ban** — Network-ban a user from every Infinity server
**/unban** — Network-unban a Discord ID
**/kick** — Kick a member from the current server
**/timeout** — Timeout a member
**/warn** — Give a warning
**/warnings** — View warnings
**/purge** — Delete messages
`
          );

        return interaction.reply({
          embeds: [embed],
          ephemeral: true
        });
      }

    } catch (error) {

      console.error(error);

      const message = {
        content:
          "❌ Something went wrong while running that command.",
        ephemeral: true
      };

      if (
        interaction.deferred ||
        interaction.replied
      ) {

        await interaction.editReply(
          message
        ).catch(() => {});

      } else {

        await interaction.reply(
          message
        ).catch(() => {});

      }
    }
  }
);

/* =========================================================
   APPEAL CHECKER

   Looks for appeals from the website.
========================================================= */

async function checkAppeals() {

  if (!client.isReady()) {
    return;
  }

  const channel =
    await client.channels.fetch(
      process.env.APPEALS_CHANNEL_ID
    ).catch(() => null);

  if (!channel) {
    return;
  }

  const result =
    await pool.query(
      `
      SELECT *
      FROM appeals

      WHERE status = 'pending'
      AND discord_message_id IS NULL

      ORDER BY created_at ASC
      `
    );

  for (const appeal of result.rows) {

    const embed =
      moderationEmbed(
        `Ban Appeal #${appeal.id}`
      )

      .setColor(0x5865f2)

      .addFields(
        {
          name: "Applicant",
          value:
            `<@${appeal.discord_id}>\n${appeal.username}\n\`${appeal.discord_id}\``
        },

        {
          name: "Why Were You Banned?",
          value:
            appeal.reason.slice(
              0,
              1000
            )
        },

        {
          name:
            "Why Should We Accept Your Appeal?",
          value:
            appeal.explanation.slice(
              0,
              1000
            )
        }
      );

    const buttons =
      new ActionRowBuilder()
        .addComponents(

          new ButtonBuilder()
            .setCustomId(
              `appeal_accept_${appeal.id}`
            )
            .setLabel(
              "Accept Appeal"
            )
            .setEmoji("✅")
            .setStyle(
              ButtonStyle.Success
            ),

          new ButtonBuilder()
            .setCustomId(
              `appeal_deny_${appeal.id}`
            )
            .setLabel(
              "Deny Appeal"
            )
            .setEmoji("❌")
            .setStyle(
              ButtonStyle.Danger
            )
        );

    const message =
      await channel.send({
        embeds: [embed],
        components: [buttons]
      });

    await pool.query(
      `
      UPDATE appeals
      SET discord_message_id = $1
      WHERE id = $2
      `,
      [
        message.id,
        appeal.id
      ]
    );
  }
}

/* =========================================================
   STAFF APPLICATION CHECKER
========================================================= */

async function checkApplications() {

  if (!client.isReady()) {
    return;
  }

  const result =
    await pool.query(
      `
      SELECT *
      FROM applications

      WHERE notified = FALSE

      ORDER BY created_at ASC
      `
    );

  for (const application of result.rows) {

    const percentage =
      Math.round(
        (
          application.score /
          application.total
        ) * 100
      );

    try {

      const user =
        await client.users.fetch(
          application.discord_id
        );

      if (application.passed) {

        await user.send({
          embeds: [
            moderationEmbed(
              "Staff Application Passed 🎉"
            )

            .setColor(0x57f287)

            .setDescription(
              "Congratulations! You passed the **Infinity Entertainment Inc. staff application.**"
            )

            .addFields({
              name: "Score",
              value:
                `${percentage}%`
            })
          ]
        });

      } else {

        await user.send({
          embeds: [
            moderationEmbed(
              "Staff Application Result"
            )

            .setColor(0xed4245)

            .setDescription(
              "Unfortunately, you did not pass the Infinity Entertainment staff application this time."
            )

            .addFields(
              {
                name: "Score",
                value:
                  `${percentage}%`
              },

              {
                name: "Reapply",
                value:
                  "You may apply again in **2 weeks**."
              }
            )
          ]
        });

      }

    } catch {}

    /* ONLY SEND PASSED APPLICATIONS TO HR */

    if (application.passed) {

      const channel =
        await client.channels.fetch(
          process.env.HR_CHANNEL_ID
        ).catch(() => null);

      if (channel) {

        const embed =
          moderationEmbed(
            "Staff Application Passed"
          )

          .setColor(0x57f287)

          .setDescription(
            "A candidate automatically passed the Infinity Entertainment staff exam."
          )

          .addFields(
            {
              name: "Applicant",
              value:
                `<@${application.discord_id}>`
            },

            {
              name: "Username",
              value:
                application.username
            },

            {
              name: "Score",
              value:
                `${percentage}%`
            },

            {
              name: "Next Step",
              value:
                "HR review / interview"
            }
          );

        await channel.send({
          embeds: [embed]
        });
      }
    }

    await pool.query(
      `
      UPDATE applications
      SET notified = TRUE
      WHERE id = $1
      `,
      [application.id]
    );
  }
}

/* =========================================================
   READY
========================================================= */

client.once(
  "ready",
  async () => {

    console.log(
      `♾️ Logged in as ${client.user.tag}`
    );

    console.log(
      `Connected to ${client.guilds.cache.size} Infinity servers.`
    );

    for (
      const guild
      of client.guilds.cache.values()
    ) {

      await syncNetworkBans(guild);
    }

    setInterval(
      checkAppeals,
      5000
    );

    setInterval(
      checkApplications,
      5000
    );

    checkAppeals();
    checkApplications();
  }
);

/* =========================================================
   START BOT
========================================================= */

(async () => {

  try {

    await setupDatabase();

    await registerCommands();

    await client.login(
      process.env.DISCORD_TOKEN
    );

  } catch (error) {

    console.error(
      "Bot startup error:",
      error
    );

  }

})();
