import pg from 'pg';

const { Pool } = pg;
let pool;

const memory = {
  teams: [
    { id: 1, code: 'team-1', name: 'Maison Cerion', playerOne: '', playerTwo: '', house: '', score: 0, malus: 0, qualified: false, eliminated: false },
    { id: 2, code: 'team-2', name: 'Maison Ignarys', playerOne: '', playerTwo: '', house: '', score: 0, malus: 0, qualified: false, eliminated: false },
    { id: 3, code: 'team-3', name: 'Maison Pavora', playerOne: '', playerTwo: '', house: '', score: 0, malus: 0, qualified: false, eliminated: false },
    { id: 4, code: 'team-4', name: 'Maison Renval', playerOne: '', playerTwo: '', house: '', score: 0, malus: 0, qualified: false, eliminated: false }
  ],
  questions: [],
  votes: [],
  buzzes: [],
  state: {
    phase: 'welcome',
    roundKey: 'welcome',
    poolKey: '',
    currentQuestionId: null,
    revealAnswer: false,
    answerStatus: '',
    publicMode: 'welcome',
    timerLabel: '',
    timerEndsAt: null,
    timerDuration: 0,
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
    preRoundSounds: [],
    preRoundCurrentSoundId: '',
    preRoundVisuals: [],
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
    dragonPlayers: ['Participant 1', 'Participant 2', 'Participant 3'],
    dragonPlayerIds: [],
    dragonActivePlayerId: null,
    dragonIndex: 0,
    dragonRevealCount: 0,
    dragonRevealQuestionId: null,
    dragonScores: {},
    dragonAnswers: {}
  },
  nextQuestionId: 1,
  nextBuzzId: 1
};

export function useMemoryStore() {
  return !process.env.DATABASE_URL;
}

export function getMemoryStore() {
  return memory;
}

export function dbReady() {
  return Boolean(process.env.DATABASE_URL) || useMemoryStore();
}

export function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL manquant.');
    }

    const sslRequired =
      process.env.PGSSLMODE === 'require' ||
      process.env.DATABASE_URL.includes('sslmode=require');

    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: sslRequired ? { rejectUnauthorized: false } : undefined
    });
  }

  return pool;
}

export async function query(sql, params = []) {
  const result = await getPool().query(sql, params);
  return result.rows;
}

export async function initDatabase() {
  if (useMemoryStore()) {
    console.log('Mode local sans base: stockage temporaire en memoire.');
    return;
  }

  const db = getPool();

  await db.query(`
    create table if not exists teams (
      id serial primary key,
      code text not null unique,
      name text not null,
      player_one text not null default '',
      player_two text not null default '',
      house text not null default '',
      score integer not null default 0,
      malus integer not null default 0,
      qualified boolean not null default false,
      eliminated boolean not null default false,
      created_at timestamptz not null default now()
    );

    create table if not exists questions (
      id serial primary key,
      play_order integer not null default 0,
      round_key text not null,
      pool_key text not null default '',
      type text not null default 'text',
      theme text not null default '',
      prompt text not null,
      answer text not null default '',
      media_url text not null default '',
      media_url_b text not null default '',
      options jsonb not null default '[]'::jsonb,
      duration_seconds integer not null default 0,
      blur_level integer not null default 14,
      created_at timestamptz not null default now()
    );

    create table if not exists game_state (
      id integer primary key default 1,
      phase text not null default 'welcome',
      round_key text not null default 'welcome',
      pool_key text not null default '',
      current_question_id integer references questions(id) on delete set null,
      reveal_answer boolean not null default false,
      answer_status text not null default '',
      public_mode text not null default 'welcome',
      timer_label text not null default '',
      timer_ends_at timestamptz,
      timer_duration integer not null default 0,
      timer_running boolean not null default false,
      buzz_locked boolean not null default false,
      buzz_winner_team_id integer references teams(id) on delete set null,
      pre_round_buzz_winner_id text not null default '',
      vote_open boolean not null default false,
      vote_title text not null default '',
      vote_options jsonb not null default '[]'::jsonb,
      public_qr_visible boolean not null default false,
      pre_round_team_names jsonb not null default '["Equipe 1","Equipe 2","Equipe 3","Equipe 4","Equipe 5","Equipe 6","Equipe 7","Equipe 8","Equipe 9","Equipe 10"]'::jsonb,
      pre_round_one_scores jsonb not null default '{}'::jsonb,
      pre_round_one_qualified_ids jsonb not null default '[]'::jsonb,
      pre_round_two_scores jsonb not null default '{}'::jsonb,
      pre_round_two_qualified_ids jsonb not null default '[]'::jsonb,
      pre_round_sounds jsonb not null default '[]'::jsonb,
      pre_round_current_sound_id text not null default '',
      pre_round_visuals jsonb not null default '[]'::jsonb,
      pre_round_current_visual_id text not null default '',
      pre_round_rejected_buzz_ids jsonb not null default '[]'::jsonb,
      round_two_team_ids jsonb not null default '[]'::jsonb,
      round_three_team_ids jsonb not null default '[]'::jsonb,
      drawing_team_ids jsonb not null default '[]'::jsonb,
      drawing_prompt text not null default 'Dessinez le logo demande',
      stroop_team_ids jsonb not null default '[]'::jsonb,
      stroop_index integer not null default 0,
      stroop_active_team_id integer references teams(id) on delete set null,
      stroop_progress jsonb not null default '{}'::jsonb,
      stroop_streaks jsonb not null default '{}'::jsonb,
      stroop_bests jsonb not null default '{}'::jsonb,
      dragon_players jsonb not null default '["Participant 1","Participant 2","Participant 3"]'::jsonb,
      dragon_player_ids jsonb not null default '[]'::jsonb,
      dragon_active_player_id integer references teams(id) on delete set null,
      dragon_index integer not null default 0,
      dragon_reveal_count integer not null default 0,
      dragon_reveal_question_id integer references questions(id) on delete set null,
      dragon_scores jsonb not null default '{}'::jsonb,
      dragon_answers jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now()
    );

    create table if not exists votes (
      id serial primary key,
      device_id text not null,
      option_id text not null,
      created_at timestamptz not null default now(),
      unique(device_id)
    );

    create table if not exists buzzes (
      id serial primary key,
      team_id integer not null references teams(id) on delete cascade,
      created_at timestamptz not null default now()
    );

    insert into game_state (id)
    values (1)
    on conflict (id) do nothing;
  `);

  await db.query(`
    alter table game_state
    add column if not exists pre_round_buzz_winner_id text not null default '';

    alter table game_state
    add column if not exists public_qr_visible boolean not null default false;

    alter table game_state
    add column if not exists pre_round_team_names jsonb not null default '["Equipe 1","Equipe 2","Equipe 3","Equipe 4","Equipe 5","Equipe 6","Equipe 7","Equipe 8","Equipe 9","Equipe 10"]'::jsonb;

    alter table game_state
    add column if not exists pre_round_one_scores jsonb not null default '{}'::jsonb;

    alter table game_state
    add column if not exists pre_round_one_qualified_ids jsonb not null default '[]'::jsonb;

    alter table game_state
    add column if not exists pre_round_two_scores jsonb not null default '{}'::jsonb;

    alter table game_state
    add column if not exists pre_round_two_qualified_ids jsonb not null default '[]'::jsonb;

    alter table game_state
    add column if not exists pre_round_sounds jsonb not null default '[]'::jsonb;

    alter table game_state
    add column if not exists pre_round_current_sound_id text not null default '';

    alter table game_state
    add column if not exists pre_round_visuals jsonb not null default '[]'::jsonb;

    alter table game_state
    add column if not exists pre_round_current_visual_id text not null default '';

    alter table game_state
    add column if not exists pre_round_rejected_buzz_ids jsonb not null default '[]'::jsonb;

    alter table game_state
    add column if not exists answer_status text not null default '';

    alter table game_state
    add column if not exists round_two_team_ids jsonb not null default '[]'::jsonb;

    alter table game_state
    add column if not exists round_three_team_ids jsonb not null default '[]'::jsonb;

    alter table game_state
    add column if not exists drawing_team_ids jsonb not null default '[]'::jsonb;

    alter table game_state
    add column if not exists drawing_prompt text not null default 'Dessinez le logo demande';

    alter table game_state
    add column if not exists stroop_team_ids jsonb not null default '[]'::jsonb;

    alter table game_state
    add column if not exists stroop_index integer not null default 0;

    alter table game_state
    add column if not exists stroop_active_team_id integer references teams(id) on delete set null;

    alter table game_state
    add column if not exists stroop_progress jsonb not null default '{}'::jsonb;

    alter table game_state
    add column if not exists stroop_streaks jsonb not null default '{}'::jsonb;

    alter table game_state
    add column if not exists stroop_bests jsonb not null default '{}'::jsonb;

    alter table game_state
    add column if not exists dragon_players jsonb not null default '["Participant 1","Participant 2","Participant 3"]'::jsonb;

    alter table game_state
    add column if not exists dragon_player_ids jsonb not null default '[]'::jsonb;

    alter table game_state
    add column if not exists dragon_active_player_id integer references teams(id) on delete set null;

    alter table game_state
    add column if not exists dragon_index integer not null default 0;

    alter table game_state
    add column if not exists dragon_reveal_count integer not null default 0;

    alter table game_state
    add column if not exists dragon_reveal_question_id integer references questions(id) on delete set null;

    alter table game_state
    add column if not exists dragon_scores jsonb not null default '{}'::jsonb;

    alter table game_state
    add column if not exists dragon_answers jsonb not null default '{}'::jsonb;

    alter table teams
    add column if not exists code text;

    alter table teams
    add column if not exists player_one text not null default '';

    alter table teams
    add column if not exists player_two text not null default '';

    alter table teams
    add column if not exists house text not null default '';

    alter table teams
    add column if not exists qualified boolean not null default false;

    alter table teams
    add column if not exists eliminated boolean not null default false;

    alter table questions
    add column if not exists play_order integer not null default 0;

    alter table questions
    add column if not exists round_key text not null default 'round1';

    alter table questions
    add column if not exists pool_key text not null default '';

    alter table questions
    add column if not exists media_url text not null default '';

    alter table questions
    add column if not exists media_url_b text not null default '';

    alter table questions
    add column if not exists options jsonb not null default '[]'::jsonb;

    alter table questions
    add column if not exists duration_seconds integer not null default 0;

    alter table questions
    add column if not exists blur_level integer not null default 14;
  `);

  await db.query(`
    update teams
    set code = coalesce(code, 'team-' || id::text)
    where code is null;
  `);

  await db.query(`
    do $$
    begin
      if not exists (
        select 1 from pg_constraint where conname = 'teams_code_key'
      ) then
        alter table teams add constraint teams_code_key unique (code);
      end if;
    end $$;
  `);

  const defaultTeams = ['Maison Cerion', 'Maison Ignarys', 'Maison Pavora', 'Maison Renval'];

  for (let index = 1; index <= 4; index += 1) {
    await query(
      `insert into teams (code, name) values ($1, $2)
       on conflict (code) do update
       set name = case
         when teams.name = $3 then excluded.name
         else teams.name
       end`,
      [`team-${index}`, defaultTeams[index - 1], `Equipe ${index}`]
    );
  }
}
