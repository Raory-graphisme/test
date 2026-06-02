import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { dbReady, getMemoryStore, initDatabase, query, useMemoryStore } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const port = process.env.PORT || 3000;
const host = process.env.HOST || (process.env.RAILWAY_ENVIRONMENT ? '0.0.0.0' : '127.0.0.1');
const adminPassword = process.env.ADMIN_PASSWORD || 'lisaa';
const uploadsPath = path.join(__dirname, '..', 'uploads');
const audioUploadsPath = path.join(uploadsPath, 'audio');
const visualUploadsPath = path.join(uploadsPath, 'visuals');

app.use(express.json({ limit: '200mb' }));
app.use('/uploads', express.static(uploadsPath));

function requireAdmin(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || '';
  if (token !== adminPassword) {
    return res.status(401).json({ error: 'Mot de passe admin incorrect.' });
  }
  next();
}

function deviceId(req) {
  return req.headers['x-device-id'] || crypto.randomUUID();
}

async function snapshot() {
  if (useMemoryStore()) {
    const store = getMemoryStore();
    const currentQuestion = store.questions.find((question) => question.id === store.state.currentQuestionId);
    const voteMap = new Map();
    for (const vote of store.votes) voteMap.set(vote.optionId, (voteMap.get(vote.optionId) || 0) + 1);
    return {
      state: {
        ...store.state,
        currentQuestion: currentQuestion || null
      },
      teams: store.teams,
      questions: [...store.questions].sort((a, b) => (a.order - b.order) || (a.id - b.id)),
      votes: [...voteMap.entries()].map(([option_id, count]) => ({ option_id, count })),
      buzzes: store.buzzes.map((buzz) => ({
        id: buzz.id,
        team_id: buzz.teamId,
        created_at: buzz.createdAt,
        team_name: store.teams.find((team) => team.id === buzz.teamId)?.name || ''
      }))
    };
  }

  const [state] = await query(`
    select gs.*, q.id as question_id, q.play_order, q.round_key as question_round_key,
      q.pool_key as question_pool_key, q.type, q.theme, q.prompt, q.answer,
      q.media_url, q.media_url_b, q.options, q.duration_seconds, q.blur_level
    from game_state gs
    left join questions q on q.id = gs.current_question_id
    where gs.id = 1
  `);
  const teams = await query('select * from teams order by id asc');
  const questions = await query('select * from questions order by play_order asc, id asc');
  const votes = await query('select option_id, count(*)::int as count from votes group by option_id');
  const buzzes = await query(`
    select b.id, b.team_id, b.created_at, t.name as team_name
    from buzzes b
    join teams t on t.id = b.team_id
    order by b.created_at asc
    limit 20
  `);

  return {
    state: {
      phase: state.phase,
      roundKey: state.round_key,
      poolKey: state.pool_key,
      publicMode: state.public_mode,
      revealAnswer: state.reveal_answer,
      answerStatus: state.answer_status,
      timerLabel: state.timer_label,
      timerEndsAt: state.timer_ends_at,
      timerDuration: state.timer_duration,
      timerRunning: state.timer_running,
      buzzLocked: state.buzz_locked,
      buzzWinnerTeamId: state.buzz_winner_team_id,
      preRoundBuzzWinnerId: state.pre_round_buzz_winner_id || '',
      voteOpen: state.vote_open,
      voteTitle: state.vote_title,
      voteOptions: state.vote_options || [],
      publicQrVisible: state.public_qr_visible,
      preRoundTeamNames: state.pre_round_team_names || Array.from({ length: 10 }, (_, index) => `Equipe ${index + 1}`),
      preRoundOneScores: state.pre_round_one_scores || {},
      preRoundOneQualifiedIds: state.pre_round_one_qualified_ids || [],
      preRoundTwoScores: state.pre_round_two_scores || {},
      preRoundTwoQualifiedIds: state.pre_round_two_qualified_ids || [],
      preRoundSounds: state.pre_round_sounds || [],
      preRoundCurrentSoundId: state.pre_round_current_sound_id || '',
      preRoundVisuals: state.pre_round_visuals || [],
      preRoundCurrentVisualId: state.pre_round_current_visual_id || '',
      preRoundRejectedBuzzIds: state.pre_round_rejected_buzz_ids || [],
      roundTwoTeamIds: state.round_two_team_ids || [],
      roundThreeTeamIds: state.round_three_team_ids || [],
      drawingTeamIds: state.drawing_team_ids || [],
      drawingPrompt: state.drawing_prompt || '',
      stroopTeamIds: state.stroop_team_ids || [],
      stroopIndex: state.stroop_index || 0,
      stroopActiveTeamId: state.stroop_active_team_id,
      stroopProgress: state.stroop_progress || {},
      stroopStreaks: state.stroop_streaks || {},
      stroopBests: state.stroop_bests || {},
      dragonPlayers: state.dragon_players || ['Participant 1', 'Participant 2', 'Participant 3'],
      dragonPlayerIds: state.dragon_player_ids || [],
      dragonActivePlayerId: state.dragon_active_player_id,
      dragonIndex: state.dragon_index || 0,
      dragonRevealCount: state.dragon_reveal_count || 0,
      dragonRevealQuestionId: state.dragon_reveal_question_id,
      dragonScores: state.dragon_scores || {},
      dragonAnswers: state.dragon_answers || {},
      currentQuestion: state.question_id
        ? {
            id: state.question_id,
            order: state.play_order,
            roundKey: state.question_round_key,
            poolKey: state.question_pool_key,
            type: state.type,
            theme: state.theme,
            prompt: state.prompt,
            answer: state.answer,
            mediaUrl: state.media_url,
            mediaUrlB: state.media_url_b,
            options: state.options || [],
            durationSeconds: state.duration_seconds,
            blurLevel: state.blur_level
          }
        : null
    },
    teams: teams.map((team) => ({
      id: team.id,
      code: team.code,
      name: team.name,
      playerOne: team.player_one,
      playerTwo: team.player_two,
      house: team.house,
      score: team.score,
      malus: team.malus,
      qualified: team.qualified,
      eliminated: team.eliminated
    })),
    questions: questions.map((question) => ({
      id: question.id,
      order: question.play_order,
      roundKey: question.round_key,
      poolKey: question.pool_key,
      type: question.type,
      theme: question.theme,
      prompt: question.prompt,
      answer: question.answer,
      mediaUrl: question.media_url,
      mediaUrlB: question.media_url_b,
      options: question.options || [],
      durationSeconds: question.duration_seconds,
      blurLevel: question.blur_level
    })),
    votes,
    buzzes
  };
}

async function broadcast() {
  io.emit('snapshot', await snapshot());
}

async function mutate(res, action) {
  try {
    const result = await action();
    await broadcast();
    res.json(result || { ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, database: dbReady() });
});

app.get('/api/snapshot', async (_req, res) => {
  res.json(await snapshot());
});

app.post('/api/admin/login', (req, res) => {
  if (req.body.password !== adminPassword) {
    return res.status(401).json({ error: 'Mot de passe incorrect.' });
  }
  res.json({ ok: true, token: adminPassword });
});

app.patch('/api/teams/:id', requireAdmin, (req, res) => {
  mutate(res, async () => {
    if (useMemoryStore()) {
      const store = getMemoryStore();
      const team = store.teams.find((item) => item.id === Number(req.params.id));
      if (!team) throw new Error('Equipe introuvable.');
      Object.assign(team, Object.fromEntries(Object.entries(req.body).filter(([, value]) => value !== undefined)));
      return;
    }

    const { name, playerOne, playerTwo, house, score, malus, qualified, eliminated } = req.body;
    await query(
      `update teams set
        name = coalesce($1, name),
        player_one = coalesce($2, player_one),
        player_two = coalesce($3, player_two),
        house = coalesce($4, house),
        score = coalesce($5, score),
        malus = coalesce($6, malus),
        qualified = coalesce($7, qualified),
        eliminated = coalesce($8, eliminated)
       where id = $9`,
      [
        name ?? null,
        playerOne ?? null,
        playerTwo ?? null,
        house ?? null,
        Number.isFinite(Number(score)) ? Number(score) : null,
        Number.isFinite(Number(malus)) ? Number(malus) : null,
        typeof qualified === 'boolean' ? qualified : null,
        typeof eliminated === 'boolean' ? eliminated : null,
        req.params.id
      ]
    );
  });
});

app.post('/api/questions/import', requireAdmin, (req, res) => {
  mutate(res, async () => {
    const questions = Array.isArray(req.body.questions) ? req.body.questions : [];
    if (!questions.length) throw new Error('Aucune question a importer.');

    if (useMemoryStore()) {
      const store = getMemoryStore();
      for (const item of questions) {
        if (!item.prompt?.trim()) continue;
        store.questions.push({
          id: store.nextQuestionId,
          order: Number(item.order || item.play_order) || store.nextQuestionId,
          roundKey: item.round || item.roundKey || 'round1',
          poolKey: item.pool || item.poolKey || '',
          type: item.type || 'text',
          theme: item.theme || '',
          prompt: item.prompt,
          answer: item.answer || '',
          mediaUrl: item.imageUrl || item.mediaUrl || '',
          mediaUrlB: item.imageUrlB || item.mediaUrlB || '',
          options: [item.optionA, item.optionB, item.optionC, item.optionD].filter(Boolean),
          durationSeconds: Number(item.durationSeconds || item.duration) || 0,
          blurLevel: Number(item.blurLevel) || 14
        });
        store.nextQuestionId += 1;
      }
      return { imported: questions.length };
    }

    for (const item of questions) {
      if (!item.prompt?.trim()) continue;
      await query(
        `insert into questions
          (play_order, round_key, pool_key, type, theme, prompt, answer, media_url, media_url_b, options, duration_seconds, blur_level)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)`,
        [
          Number(item.order || item.play_order) || 0,
          item.round || item.roundKey || 'round1',
          item.pool || item.poolKey || '',
          item.type || 'text',
          item.theme || '',
          item.prompt,
          item.answer || '',
          item.imageUrl || item.mediaUrl || '',
          item.imageUrlB || item.mediaUrlB || '',
          JSON.stringify([item.optionA, item.optionB, item.optionC, item.optionD].filter(Boolean)),
          Number(item.durationSeconds || item.duration) || 0,
          Number(item.blurLevel) || 14
        ]
      );
    }
    return { imported: questions.length };
  });
});

app.post('/api/audio/import', requireAdmin, (req, res) => {
  mutate(res, async () => {
    const files = Array.isArray(req.body.files) ? req.body.files : [];
    if (!files.length) throw new Error('Aucun son a importer.');
    await fs.mkdir(audioUploadsPath, { recursive: true });

    const imported = [];
    for (const file of files) {
      const originalName = String(file.name || 'son.mp3');
      const extension = path.extname(originalName).toLowerCase() || '.mp3';
      const safeBase = path.basename(originalName, extension).replace(/[^a-z0-9_-]+/gi, '-').slice(0, 60) || 'son';
      const id = crypto.randomUUID();
      const fileName = `${Date.now()}-${id}-${safeBase}${extension}`;
      const data = String(file.data || '').replace(/^data:[^;]+;base64,/, '');
      if (!data) continue;
      await fs.writeFile(path.join(audioUploadsPath, fileName), Buffer.from(data, 'base64'));
      imported.push({
        id,
        name: originalName,
        url: `/uploads/audio/${fileName}`,
        type: file.type || 'audio/mpeg'
      });
    }
    if (!imported.length) throw new Error('Aucun son valide.');

    if (useMemoryStore()) {
      const store = getMemoryStore();
      store.state.preRoundSounds = [...(store.state.preRoundSounds || []), ...imported];
      return { imported: imported.length };
    }

    const [state] = await query('select pre_round_sounds from game_state where id = 1');
    const sounds = Array.isArray(state?.pre_round_sounds) ? state.pre_round_sounds : [];
    await query('update game_state set pre_round_sounds = $1::jsonb where id = 1', [JSON.stringify([...sounds, ...imported])]);
    return { imported: imported.length };
  });
});

app.post('/api/visual/import', requireAdmin, (req, res) => {
  mutate(res, async () => {
    const files = Array.isArray(req.body.files) ? req.body.files : [];
    if (!files.length) throw new Error('Aucun visuel a importer.');
    await fs.mkdir(visualUploadsPath, { recursive: true });

    const allowedExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.avif']);
    const imported = [];
    for (const file of files) {
      const originalName = String(file.name || 'visuel.png');
      const extension = path.extname(originalName).toLowerCase() || '.png';
      if (!allowedExtensions.has(extension)) continue;
      const safeBase = path.basename(originalName, extension).replace(/[^a-z0-9_-]+/gi, '-').slice(0, 60) || 'visuel';
      const id = crypto.randomUUID();
      const fileName = `${Date.now()}-${id}-${safeBase}${extension}`;
      const data = String(file.data || '').replace(/^data:[^;]+;base64,/, '');
      if (!data) continue;
      await fs.writeFile(path.join(visualUploadsPath, fileName), Buffer.from(data, 'base64'));
      imported.push({
        id,
        name: originalName,
        url: `/uploads/visuals/${fileName}`,
        type: file.type || 'image/png'
      });
    }
    if (!imported.length) throw new Error('Aucun visuel valide.');

    if (useMemoryStore()) {
      const store = getMemoryStore();
      store.state.preRoundVisuals = [...(store.state.preRoundVisuals || []), ...imported];
      return { imported: imported.length };
    }

    const [state] = await query('select pre_round_visuals from game_state where id = 1');
    const visuals = Array.isArray(state?.pre_round_visuals) ? state.pre_round_visuals : [];
    await query('update game_state set pre_round_visuals = $1::jsonb where id = 1', [JSON.stringify([...visuals, ...imported])]);
    return { imported: imported.length };
  });
});

app.delete('/api/questions', requireAdmin, (req, res) => {
  mutate(res, async () => {
    if (useMemoryStore()) {
      const store = getMemoryStore();
      store.questions = [];
      store.state.currentQuestionId = null;
      return;
    }

    await query('delete from questions');
  });
});

app.post('/api/game/state', requireAdmin, (req, res) => {
  mutate(res, async () => {
    if (useMemoryStore()) {
      const store = getMemoryStore();
      const keys = {
        phase: 'phase',
        roundKey: 'roundKey',
        poolKey: 'poolKey',
        publicMode: 'publicMode',
        currentQuestionId: 'currentQuestionId',
        revealAnswer: 'revealAnswer',
        answerStatus: 'answerStatus',
        buzzLocked: 'buzzLocked',
        buzzWinnerTeamId: 'buzzWinnerTeamId',
        preRoundBuzzWinnerId: 'preRoundBuzzWinnerId',
        publicQrVisible: 'publicQrVisible',
        preRoundTeamNames: 'preRoundTeamNames',
        preRoundOneScores: 'preRoundOneScores',
        preRoundOneQualifiedIds: 'preRoundOneQualifiedIds',
        preRoundTwoScores: 'preRoundTwoScores',
        preRoundTwoQualifiedIds: 'preRoundTwoQualifiedIds',
        preRoundSounds: 'preRoundSounds',
        preRoundCurrentSoundId: 'preRoundCurrentSoundId',
        preRoundVisuals: 'preRoundVisuals',
        preRoundCurrentVisualId: 'preRoundCurrentVisualId',
        preRoundRejectedBuzzIds: 'preRoundRejectedBuzzIds',
        roundTwoTeamIds: 'roundTwoTeamIds',
        roundThreeTeamIds: 'roundThreeTeamIds',
        drawingTeamIds: 'drawingTeamIds',
        drawingPrompt: 'drawingPrompt',
        stroopTeamIds: 'stroopTeamIds',
        stroopIndex: 'stroopIndex',
        stroopActiveTeamId: 'stroopActiveTeamId',
        stroopProgress: 'stroopProgress',
        stroopStreaks: 'stroopStreaks',
        stroopBests: 'stroopBests',
        dragonPlayers: 'dragonPlayers',
        dragonPlayerIds: 'dragonPlayerIds',
        dragonActivePlayerId: 'dragonActivePlayerId',
        dragonIndex: 'dragonIndex',
        dragonRevealCount: 'dragonRevealCount',
        dragonRevealQuestionId: 'dragonRevealQuestionId',
        dragonScores: 'dragonScores',
        dragonAnswers: 'dragonAnswers'
      };
      for (const [bodyKey, stateKey] of Object.entries(keys)) {
        if (Object.prototype.hasOwnProperty.call(req.body, bodyKey)) {
          store.state[stateKey] = req.body[bodyKey];
        }
      }
      return;
    }

    const allowed = ['phase', 'roundKey', 'poolKey', 'publicMode', 'currentQuestionId', 'revealAnswer', 'answerStatus', 'buzzLocked', 'buzzWinnerTeamId', 'preRoundBuzzWinnerId', 'publicQrVisible', 'preRoundTeamNames', 'preRoundOneScores', 'preRoundOneQualifiedIds', 'preRoundTwoScores', 'preRoundTwoQualifiedIds', 'preRoundSounds', 'preRoundCurrentSoundId', 'preRoundVisuals', 'preRoundCurrentVisualId', 'preRoundRejectedBuzzIds', 'roundTwoTeamIds', 'roundThreeTeamIds', 'drawingTeamIds', 'drawingPrompt', 'stroopTeamIds', 'stroopIndex', 'stroopActiveTeamId', 'stroopProgress', 'stroopStreaks', 'stroopBests', 'dragonPlayers', 'dragonPlayerIds', 'dragonActivePlayerId', 'dragonIndex', 'dragonRevealCount', 'dragonRevealQuestionId', 'dragonScores', 'dragonAnswers'];
    const body = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)));
    const currentQuestionProvided = Object.prototype.hasOwnProperty.call(body, 'currentQuestionId');

    await query(
      `update game_state set
        phase = coalesce($1, phase),
        round_key = coalesce($2, round_key),
        pool_key = coalesce($3, pool_key),
        public_mode = coalesce($4, public_mode),
        current_question_id = case when $5 then $6 else current_question_id end,
        reveal_answer = coalesce($7, reveal_answer),
        answer_status = coalesce($8, answer_status),
        buzz_locked = coalesce($9, buzz_locked),
        buzz_winner_team_id = case when $10 then $11 else buzz_winner_team_id end,
        pre_round_buzz_winner_id = case when $12 then $13 else pre_round_buzz_winner_id end,
        public_qr_visible = coalesce($14, public_qr_visible),
        pre_round_team_names = coalesce($15::jsonb, pre_round_team_names),
        pre_round_one_scores = coalesce($16::jsonb, pre_round_one_scores),
        pre_round_one_qualified_ids = coalesce($17::jsonb, pre_round_one_qualified_ids),
        pre_round_two_scores = coalesce($18::jsonb, pre_round_two_scores),
        pre_round_two_qualified_ids = coalesce($19::jsonb, pre_round_two_qualified_ids),
        pre_round_sounds = coalesce($20::jsonb, pre_round_sounds),
        pre_round_current_sound_id = coalesce($21, pre_round_current_sound_id),
        pre_round_visuals = coalesce($22::jsonb, pre_round_visuals),
        pre_round_current_visual_id = coalesce($23, pre_round_current_visual_id),
        pre_round_rejected_buzz_ids = coalesce($24::jsonb, pre_round_rejected_buzz_ids),
        round_two_team_ids = coalesce($25::jsonb, round_two_team_ids),
        round_three_team_ids = coalesce($26::jsonb, round_three_team_ids),
        drawing_team_ids = coalesce($27::jsonb, drawing_team_ids),
        drawing_prompt = coalesce($28, drawing_prompt),
        stroop_team_ids = coalesce($29::jsonb, stroop_team_ids),
        stroop_index = coalesce($30, stroop_index),
        stroop_active_team_id = case when $31 then $32 else stroop_active_team_id end,
        stroop_progress = coalesce($33::jsonb, stroop_progress),
        stroop_streaks = coalesce($34::jsonb, stroop_streaks),
        stroop_bests = coalesce($35::jsonb, stroop_bests),
        dragon_players = coalesce($36::jsonb, dragon_players),
        dragon_player_ids = coalesce($37::jsonb, dragon_player_ids),
        dragon_active_player_id = case when $38 then $39 else dragon_active_player_id end,
        dragon_index = coalesce($40, dragon_index),
        dragon_reveal_count = coalesce($41, dragon_reveal_count),
        dragon_reveal_question_id = case when $42 then $43 else dragon_reveal_question_id end,
        dragon_scores = coalesce($44::jsonb, dragon_scores),
        dragon_answers = coalesce($45::jsonb, dragon_answers),
        updated_at = now()
       where id = 1`,
      [
        body.phase ?? null,
        body.roundKey ?? null,
        body.poolKey ?? null,
        body.publicMode ?? null,
        currentQuestionProvided,
        body.currentQuestionId || null,
        typeof body.revealAnswer === 'boolean' ? body.revealAnswer : null,
        body.answerStatus ?? null,
        typeof body.buzzLocked === 'boolean' ? body.buzzLocked : null,
        Object.prototype.hasOwnProperty.call(body, 'buzzWinnerTeamId'),
        body.buzzWinnerTeamId ? Number(body.buzzWinnerTeamId) : null,
        Object.prototype.hasOwnProperty.call(body, 'preRoundBuzzWinnerId'),
        body.preRoundBuzzWinnerId ? String(body.preRoundBuzzWinnerId) : '',
        typeof body.publicQrVisible === 'boolean' ? body.publicQrVisible : null,
        Array.isArray(body.preRoundTeamNames) ? JSON.stringify(body.preRoundTeamNames.slice(0, 10)) : null,
        body.preRoundOneScores && typeof body.preRoundOneScores === 'object' && !Array.isArray(body.preRoundOneScores) ? JSON.stringify(body.preRoundOneScores) : null,
        Array.isArray(body.preRoundOneQualifiedIds) ? JSON.stringify(body.preRoundOneQualifiedIds) : null,
        body.preRoundTwoScores && typeof body.preRoundTwoScores === 'object' && !Array.isArray(body.preRoundTwoScores) ? JSON.stringify(body.preRoundTwoScores) : null,
        Array.isArray(body.preRoundTwoQualifiedIds) ? JSON.stringify(body.preRoundTwoQualifiedIds) : null,
        Array.isArray(body.preRoundSounds) ? JSON.stringify(body.preRoundSounds) : null,
        body.preRoundCurrentSoundId ?? null,
        Array.isArray(body.preRoundVisuals) ? JSON.stringify(body.preRoundVisuals) : null,
        body.preRoundCurrentVisualId ?? null,
        Array.isArray(body.preRoundRejectedBuzzIds) ? JSON.stringify(body.preRoundRejectedBuzzIds) : null,
        Array.isArray(body.roundTwoTeamIds) ? JSON.stringify(body.roundTwoTeamIds) : null,
        Array.isArray(body.roundThreeTeamIds) ? JSON.stringify(body.roundThreeTeamIds) : null,
        Array.isArray(body.drawingTeamIds) ? JSON.stringify(body.drawingTeamIds) : null,
        body.drawingPrompt ?? null,
        Array.isArray(body.stroopTeamIds) ? JSON.stringify(body.stroopTeamIds) : null,
        Number.isFinite(Number(body.stroopIndex)) ? Number(body.stroopIndex) : null,
        Object.prototype.hasOwnProperty.call(body, 'stroopActiveTeamId'),
        body.stroopActiveTeamId ? Number(body.stroopActiveTeamId) : null,
        body.stroopProgress && typeof body.stroopProgress === 'object' && !Array.isArray(body.stroopProgress) ? JSON.stringify(body.stroopProgress) : null,
        body.stroopStreaks && typeof body.stroopStreaks === 'object' && !Array.isArray(body.stroopStreaks) ? JSON.stringify(body.stroopStreaks) : null,
        body.stroopBests && typeof body.stroopBests === 'object' && !Array.isArray(body.stroopBests) ? JSON.stringify(body.stroopBests) : null,
        Array.isArray(body.dragonPlayers) ? JSON.stringify(body.dragonPlayers.slice(0, 3)) : null,
        Array.isArray(body.dragonPlayerIds) ? JSON.stringify(body.dragonPlayerIds) : null,
        Object.prototype.hasOwnProperty.call(body, 'dragonActivePlayerId'),
        body.dragonActivePlayerId ? Number(body.dragonActivePlayerId) : null,
        Number.isFinite(Number(body.dragonIndex)) ? Number(body.dragonIndex) : null,
        Number.isFinite(Number(body.dragonRevealCount)) ? Number(body.dragonRevealCount) : null,
        Object.prototype.hasOwnProperty.call(body, 'dragonRevealQuestionId'),
        body.dragonRevealQuestionId ? Number(body.dragonRevealQuestionId) : null,
        body.dragonScores && typeof body.dragonScores === 'object' && !Array.isArray(body.dragonScores) ? JSON.stringify(body.dragonScores) : null,
        body.dragonAnswers && typeof body.dragonAnswers === 'object' && !Array.isArray(body.dragonAnswers) ? JSON.stringify(body.dragonAnswers) : null
      ]
    );
  });
});

app.post('/api/round3/question', requireAdmin, (req, res) => {
  mutate(res, async () => {
    const teamIds = Array.isArray(req.body.teamIds) ? req.body.teamIds.map(String).slice(0, 2) : [];
    const questionId = Number(req.body.questionId) || null;
    if (useMemoryStore()) {
      const store = getMemoryStore();
      store.buzzes = [];
      store.state.roundKey = 'round3';
      store.state.phase = 'round3';
      store.state.publicMode = 'question';
      store.state.currentQuestionId = questionId;
      store.state.revealAnswer = false;
      store.state.answerStatus = '';
      store.state.roundThreeTeamIds = teamIds;
      store.state.buzzLocked = false;
      store.state.buzzWinnerTeamId = null;
      return;
    }

    await query('delete from buzzes');
    await query(
      `update game_state set
        round_key = 'round3',
        phase = 'round3',
        public_mode = 'question',
        current_question_id = $1,
        reveal_answer = false,
        answer_status = '',
        round_three_team_ids = $2::jsonb,
        buzz_locked = false,
        buzz_winner_team_id = null,
        updated_at = now()
       where id = 1`,
      [questionId, JSON.stringify(teamIds)]
    );
  });
});

app.post('/api/round3/answer', requireAdmin, (req, res) => {
  mutate(res, async () => {
    const correct = Boolean(req.body.correct);
    if (useMemoryStore()) {
      const store = getMemoryStore();
      const winnerId = Number(store.state.buzzWinnerTeamId);
      if (!winnerId) throw new Error('Aucun buzz pour cette question.');
      const selectedIds = (store.state.roundThreeTeamIds || []).map(Number);
      if (!selectedIds.includes(winnerId)) throw new Error('Le buzz ne correspond pas aux equipes selectionnees.');
      const scoringTeamId = correct ? winnerId : selectedIds.find((id) => id !== winnerId);
      if (!scoringTeamId) throw new Error('Impossible de trouver l equipe qui marque.');
      const team = store.teams.find((item) => item.id === scoringTeamId);
      if (team) team.score += 1;
      store.state.revealAnswer = true;
      store.state.answerStatus = correct ? 'correct' : 'wrong';
      return { scoringTeamId };
    }

    const [state] = await query('select buzz_winner_team_id, round_three_team_ids from game_state where id = 1');
    const winnerId = Number(state?.buzz_winner_team_id);
    if (!winnerId) throw new Error('Aucun buzz pour cette question.');
    const selectedIds = (state.round_three_team_ids || []).map(Number);
    if (!selectedIds.includes(winnerId)) throw new Error('Le buzz ne correspond pas aux equipes selectionnees.');
    const scoringTeamId = correct ? winnerId : selectedIds.find((id) => id !== winnerId);
    if (!scoringTeamId) throw new Error('Impossible de trouver l equipe qui marque.');
    await query('update teams set score = score + 1 where id = $1', [scoringTeamId]);
    await query(
      'update game_state set reveal_answer = true, answer_status = $1 where id = 1',
      [correct ? 'correct' : 'wrong']
    );
    return { scoringTeamId };
  });
});

app.post('/api/drawing/launch', requireAdmin, (req, res) => {
  mutate(res, async () => {
    const mode = req.body.mode === 'task' ? 'drawing-task' : 'drawing-intro';
    const teamIds = Array.isArray(req.body.teamIds) ? req.body.teamIds.map(String).slice(0, 2) : [];
    const prompt = String(req.body.prompt || '').trim() || 'Consigne';

    if (useMemoryStore()) {
      const store = getMemoryStore();
      store.state.roundKey = 'drawing';
      store.state.phase = 'drawing';
      store.state.currentQuestionId = null;
      store.state.publicMode = mode;
      store.state.drawingTeamIds = teamIds;
      store.state.drawingPrompt = prompt;
      store.state.publicQrVisible = false;
      if (mode === 'drawing-task') {
        store.state.timerLabel = 'Dessin';
        store.state.timerDuration = 60;
        store.state.timerEndsAt = new Date(Date.now() + 60 * 1000).toISOString();
        store.state.timerRunning = true;
      }
      return;
    }

    const timerEndsAt = mode === 'drawing-task' ? new Date(Date.now() + 60 * 1000) : null;
    await query(
      `update game_state set
        round_key = 'drawing',
        phase = 'drawing',
        current_question_id = null,
        public_mode = $1,
        drawing_team_ids = $2::jsonb,
        drawing_prompt = $3,
        public_qr_visible = false,
        timer_label = case when $4 then 'Dessin' else timer_label end,
        timer_duration = case when $4 then 60 else timer_duration end,
        timer_ends_at = case when $4 then $5 else timer_ends_at end,
        timer_running = case when $4 then true else timer_running end,
        updated_at = now()
       where id = 1`,
      [mode, JSON.stringify(teamIds), prompt, mode === 'drawing-task', timerEndsAt]
    );
  });
});

app.post('/api/timer/start', requireAdmin, (req, res) => {
  mutate(res, async () => {
    const seconds = Math.max(1, Number(req.body.seconds) || 60);
    if (useMemoryStore()) {
      const store = getMemoryStore();
      store.state.timerLabel = req.body.label || 'Timer';
      store.state.timerDuration = seconds;
      store.state.timerEndsAt = new Date(Date.now() + seconds * 1000).toISOString();
      store.state.timerRunning = true;
      return;
    }

    await query(
      `update game_state set timer_label = $1, timer_duration = $2,
       timer_ends_at = now() + ($2::int * interval '1 second'),
       timer_running = true where id = 1`,
      [req.body.label || 'Timer', seconds]
    );
  });
});

app.post('/api/timer/stop', requireAdmin, (req, res) => {
  mutate(res, async () => {
    if (useMemoryStore()) {
      const store = getMemoryStore();
      store.state.timerRunning = false;
      store.state.timerEndsAt = null;
      return;
    }

    await query('update game_state set timer_running = false, timer_ends_at = null where id = 1');
  });
});

app.post('/api/buzzer/reset', requireAdmin, (req, res) => {
  mutate(res, async () => {
    if (useMemoryStore()) {
      const store = getMemoryStore();
      store.buzzes = [];
      store.state.buzzLocked = false;
      store.state.buzzWinnerTeamId = null;
      store.state.preRoundBuzzWinnerId = '';
      store.state.preRoundRejectedBuzzIds = [];
      return;
    }

    await query('delete from buzzes');
    await query(`update game_state set buzz_locked = false, buzz_winner_team_id = null,
      pre_round_buzz_winner_id = '', pre_round_rejected_buzz_ids = '[]'::jsonb where id = 1`);
  });
});

function resolveBuzzerSlot(state, slot) {
  const ids = (state.roundThreeTeamIds || state.round_three_team_ids || []).map(Number);
  return ids[slot - 1] || null;
}

async function recordBuzz(teamId, res) {
  if (!teamId) {
    return res.status(400).json({ error: 'Aucune equipe associee a ce buzzer.' });
  }

  if (useMemoryStore()) {
    const store = getMemoryStore();
    const isPreRound = ['premanche1', 'premanche2'].includes(store.state.roundKey);
    const selectedIds = isPreRound
      ? (store.state.roundKey === 'premanche2' && Array.isArray(store.state.preRoundOneQualifiedIds) && store.state.preRoundOneQualifiedIds.length
          ? store.state.preRoundOneQualifiedIds.map(Number).slice(0, 7)
          : Array.from({ length: 10 }, (_, index) => index + 1))
      : (store.state.roundThreeTeamIds || []).map(Number);
    const rejectedIds = (store.state.preRoundRejectedBuzzIds || []).map(Number);
    if (selectedIds.length && !selectedIds.includes(Number(teamId))) {
      return res.status(400).json({ error: 'Cette equipe n est pas selectionnee pour les buzzers.' });
    }
    if (isPreRound && rejectedIds.includes(Number(teamId))) {
      return res.status(400).json({ error: 'Cette equipe a deja tente sa chance sur ce son.' });
    }
    if (store.state.buzzLocked) {
      return res.status(409).json({ error: 'Buzzer deja verrouille.' });
    }
    store.buzzes.push({ id: store.nextBuzzId, teamId, createdAt: new Date().toISOString() });
    store.nextBuzzId += 1;
    store.state.buzzLocked = true;
    if (isPreRound) {
      store.state.preRoundBuzzWinnerId = String(teamId);
      store.state.buzzWinnerTeamId = null;
    } else {
      store.state.buzzWinnerTeamId = teamId;
    }
    await broadcast();
    return res.json({ ok: true });
  }

  const [state] = await query('select buzz_locked, round_key, round_three_team_ids, pre_round_one_qualified_ids, pre_round_rejected_buzz_ids from game_state where id = 1');
  const isPreRound = ['premanche1', 'premanche2'].includes(state.round_key);
  const selectedIds = isPreRound
    ? (state.round_key === 'premanche2' && Array.isArray(state.pre_round_one_qualified_ids) && state.pre_round_one_qualified_ids.length
        ? state.pre_round_one_qualified_ids.map(Number).slice(0, 7)
        : Array.from({ length: 10 }, (_, index) => index + 1))
    : (state.round_three_team_ids || []).map(Number);
  const rejectedIds = (state.pre_round_rejected_buzz_ids || []).map(Number);
  if (selectedIds.length && !selectedIds.includes(Number(teamId))) {
    return res.status(400).json({ error: 'Cette equipe n est pas selectionnee pour les buzzers.' });
  }
  if (isPreRound && rejectedIds.includes(Number(teamId))) {
    return res.status(400).json({ error: 'Cette equipe a deja tente sa chance sur ce son.' });
  }
  if (state.buzz_locked) {
    return res.status(409).json({ error: 'Buzzer deja verrouille.' });
  }

  if (isPreRound) {
    await query('update game_state set buzz_locked = true, buzz_winner_team_id = null, pre_round_buzz_winner_id = $1 where id = 1', [String(teamId)]);
    await broadcast();
    return res.json({ ok: true });
  }

  await query('insert into buzzes (team_id) values ($1)', [teamId]);
  await query('update game_state set buzz_locked = true, buzz_winner_team_id = $1 where id = 1', [teamId]);
  await broadcast();
  return res.json({ ok: true });
}

app.post('/api/buzzer-slot/:slot', async (req, res) => {
  try {
    const slot = Number(req.params.slot);
    if (![1, 2].includes(slot)) throw new Error('Buzzer invalide.');
    if (useMemoryStore()) {
      const teamId = resolveBuzzerSlot(getMemoryStore().state, slot);
      return await recordBuzz(teamId, res);
    }

    const [state] = await query('select round_three_team_ids from game_state where id = 1');
    const teamId = resolveBuzzerSlot(state, slot);
    return await recordBuzz(teamId, res);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/buzzer/:teamId', async (req, res) => {
  try {
    return await recordBuzz(Number(req.params.teamId), res);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/vote/open', requireAdmin, (req, res) => {
  mutate(res, async () => {
    if (useMemoryStore()) {
      const store = getMemoryStore();
      store.votes = [];
      store.state.voteOpen = true;
      store.state.voteTitle = req.body.title || 'Vote du public';
      store.state.voteOptions = req.body.options || [];
      store.state.publicQrVisible = Boolean(req.body.publicQrVisible);
      return;
    }

    await query('delete from votes');
    await query(
      'update game_state set vote_open = true, vote_title = $1, vote_options = $2::jsonb, public_qr_visible = $3 where id = 1',
      [req.body.title || 'Vote du public', JSON.stringify(req.body.options || []), Boolean(req.body.publicQrVisible)]
    );
  });
});

app.post('/api/vote/options', requireAdmin, (req, res) => {
  mutate(res, async () => {
    if (useMemoryStore()) {
      const store = getMemoryStore();
      store.state.voteTitle = req.body.title || store.state.voteTitle || 'Vote du public';
      store.state.voteOptions = req.body.options || [];
      return;
    }

    await query(
      'update game_state set vote_title = $1, vote_options = $2::jsonb where id = 1',
      [req.body.title || 'Vote du public', JSON.stringify(req.body.options || [])]
    );
  });
});

app.post('/api/vote/close', requireAdmin, (req, res) => {
  mutate(res, async () => {
    if (useMemoryStore()) {
      getMemoryStore().state.voteOpen = false;
      return;
    }

    await query('update game_state set vote_open = false where id = 1');
  });
});

app.post('/api/vote', async (req, res) => {
  try {
    const id = deviceId(req);
    const { optionId } = req.body;
    if (!optionId) throw new Error('Vote invalide.');
    if (useMemoryStore()) {
      const store = getMemoryStore();
      if (!store.votes.some((vote) => vote.deviceId === id)) {
        store.votes.push({ deviceId: id, optionId });
      }
      await broadcast();
      return res.json({ ok: true, deviceId: id });
    }

    await query('insert into votes (device_id, option_id) values ($1, $2) on conflict (device_id) do nothing', [id, optionId]);
    await broadcast();
    res.json({ ok: true, deviceId: id });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/reset', requireAdmin, (req, res) => {
  mutate(res, async () => {
    if (useMemoryStore()) {
      const store = getMemoryStore();
      for (const team of store.teams) {
        team.score = 0;
        team.malus = 0;
        team.qualified = false;
        team.eliminated = false;
      }
      store.buzzes = [];
      store.votes = [];
      store.state = {
        ...store.state,
        phase: 'welcome',
        roundKey: 'welcome',
        poolKey: '',
        currentQuestionId: null,
        revealAnswer: false,
        answerStatus: '',
        publicMode: 'welcome',
        timerLabel: '',
        timerEndsAt: null,
        timerRunning: false,
        buzzLocked: false,
        buzzWinnerTeamId: null,
        preRoundBuzzWinnerId: '',
        voteOpen: false,
        voteTitle: '',
        voteOptions: [],
        publicQrVisible: false,
        preRoundTeamNames: Array.from({ length: 10 }, (_, index) => `Equipe ${index + 1}`),
        preRoundOneScores: {},
        preRoundOneQualifiedIds: [],
        preRoundTwoScores: {},
        preRoundTwoQualifiedIds: [],
        preRoundCurrentSoundId: '',
        preRoundCurrentVisualId: '',
        preRoundRejectedBuzzIds: [],
        roundTwoTeamIds: [],
        roundThreeTeamIds: [],
        drawingTeamIds: [],
        drawingPrompt: 'Dessinez le logo demande',
        stroopTeamIds: [],
        stroopIndex: 0,
        stroopActiveTeamId: null,
        stroopProgress: {},
        stroopStreaks: {},
        stroopBests: {},
        dragonPlayerIds: [],
        dragonActivePlayerId: null,
        dragonIndex: 0,
        dragonRevealCount: 0,
        dragonRevealQuestionId: null,
        dragonScores: {},
        dragonAnswers: {}
      };
      return;
    }

    await query('update teams set score = 0, malus = 0, qualified = false, eliminated = false');
    await query('delete from buzzes');
    await query('delete from votes');
    await query(`update game_state set phase='welcome', round_key='welcome', pool_key='', current_question_id=null,
      reveal_answer=false, answer_status='', public_mode='welcome', timer_label='', timer_ends_at=null, timer_running=false,
      buzz_locked=false, buzz_winner_team_id=null, pre_round_buzz_winner_id='', vote_open=false, vote_title='', vote_options='[]'::jsonb,
      public_qr_visible=false,
      pre_round_team_names='["Equipe 1","Equipe 2","Equipe 3","Equipe 4","Equipe 5","Equipe 6","Equipe 7","Equipe 8","Equipe 9","Equipe 10"]'::jsonb,
      pre_round_one_scores='{}'::jsonb, pre_round_one_qualified_ids='[]'::jsonb, pre_round_two_scores='{}'::jsonb,
      pre_round_two_qualified_ids='[]'::jsonb, pre_round_current_sound_id='', pre_round_current_visual_id='', pre_round_rejected_buzz_ids='[]'::jsonb,
      round_two_team_ids='[]'::jsonb, round_three_team_ids='[]'::jsonb, drawing_team_ids='[]'::jsonb,
      drawing_prompt='Dessinez le logo demande', stroop_team_ids='[]'::jsonb, stroop_index=0, stroop_active_team_id=null,
      stroop_progress='{}'::jsonb, stroop_streaks='{}'::jsonb, stroop_bests='{}'::jsonb,
      dragon_player_ids='[]'::jsonb, dragon_active_player_id=null, dragon_index=0, dragon_reveal_count=0,
      dragon_reveal_question_id=null,
      dragon_scores='{}'::jsonb, dragon_answers='{}'::jsonb where id=1`);
  });
});

io.on('connection', async (socket) => {
  socket.emit('snapshot', await snapshot());
});

const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));
app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

initDatabase()
  .then(() => {
    server.listen(port, host, () => console.log(`Live Quiz listening on ${host}:${port}`));
  })
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
