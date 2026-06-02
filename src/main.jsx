import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import Papa from 'papaparse';
import { QRCodeSVG } from 'qrcode.react';
import {
  AlarmClock,
  Check,
  Eye,
  EyeOff,
  FileUp,
  Flag,
  Image as ImageIcon,
  Lock,
  Minus,
  Plus,
  Radio,
  RotateCcw,
  Shield,
  TimerReset,
  Trophy,
  Users,
  Vote,
  X
} from 'lucide-react';
import './styles.css';

const rounds = [
  { key: 'welcome', label: 'Accueil' },
  { key: 'premanche1', label: 'PRÉMANCHE 1 - Reconnaissance sonore' },
  { key: 'premanche2', label: 'PRÉMANCHE 2 - Reconnaissance visuelle' },
  { key: 'round1', label: 'MANCHE 1 - L’Épreuve du Vrai' },
  { key: 'stroop', label: 'MINI-JEU - L’Épreuve des Illusions' },
  { key: 'round2', label: 'MANCHE 2 - Le Champ des Connaissances' },
  { key: 'drawing', label: 'MINI-JEU - Le Duel des Illustrateurs' },
  { key: 'round3', label: 'MANCHE 3 - Les Joutes du Savoir' },
  { key: 'dragon', label: 'MANCHE 4 - L’Épreuve du Dragon' }
];

const emptySnapshot = {
  state: { publicMode: 'welcome', roundKey: 'welcome', revealAnswer: false, answerStatus: '', voteOptions: [], publicQrVisible: false, currentQuestion: null, preRoundBuzzWinnerId: '', preRoundTeamNames: Array.from({ length: 10 }, (_, index) => `Equipe ${index + 1}`), preRoundOneScores: {}, preRoundOneQualifiedIds: [], preRoundTwoScores: {}, preRoundTwoQualifiedIds: [], preRoundSounds: [], preRoundCurrentSoundId: '', preRoundVisuals: [], preRoundCurrentVisualId: '', preRoundRejectedBuzzIds: [], stroopTeamIds: [], stroopIndex: 0, stroopActiveTeamId: null, stroopProgress: {}, stroopStreaks: {}, stroopBests: {}, dragonPlayers: ['Participant 1', 'Participant 2', 'Participant 3'], dragonPlayerIds: [], dragonActivePlayerId: null, dragonIndex: 0, dragonRevealCount: 0, dragonRevealQuestionId: null, dragonScores: {}, dragonAnswers: {} },
  teams: [],
  questions: [],
  votes: [],
  buzzes: []
};

const STROOP_TOTAL = 80;
const STROOP_PER_TEAM = 40;

const houseTeams = [
  { name: 'Maison Cerion', logo: '/maison-cerion.svg' },
  { name: 'Maison Ignarys', logo: '/maison-ignarys.svg' },
  { name: 'Maison Pavora', logo: '/maison-pavora.svg' },
  { name: 'Maison Renval', logo: '/maison-renval.svg' }
];

function GameLogo({ compact = false }) {
  return <img className={compact ? 'game-logo compact' : 'game-logo'} src="/logo-jeu.svg" alt="Desarts et Delettres" />;
}

function TeamLogo({ team, compact = false }) {
  if (!team?.logo) return null;
  return <img className={compact ? 'team-logo compact' : 'team-logo'} src={team.logo} alt="" aria-hidden="true" />;
}

function getPreRoundTeams(state = {}) {
  const names = Array.isArray(state.preRoundTeamNames) && state.preRoundTeamNames.length
    ? state.preRoundTeamNames
    : Array.from({ length: 10 }, (_, index) => `Equipe ${index + 1}`);
  return Array.from({ length: 10 }, (_, index) => ({
    id: String(index + 1),
    name: names[index]?.trim() || `Equipe ${index + 1}`
  }));
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function AutoPlayAudio({ sound }) {
  const audioRef = useRef(null);
  useEffect(() => {
    if (!sound || !audioRef.current) return;
    audioRef.current.currentTime = 0;
    audioRef.current.play().catch(() => {});
  }, [sound?.id]);

  if (!sound) return null;
  return (
    <audio
      key={sound.id}
      ref={audioRef}
      src={sound.url}
      controls
      autoPlay
      preload="auto"
      onCanPlay={() => audioRef.current?.play().catch(() => {})}
    />
  );
}

function getDeviceId() {
  let id = localStorage.getItem('deviceId');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('deviceId', id);
  }
  return id;
}

function headers() {
  const token = localStorage.getItem('adminToken');
  return {
    'Content-Type': 'application/json',
    'X-Device-Id': getDeviceId(),
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...headers(), ...options.headers }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Action impossible.');
  return data;
}

function useLive() {
  const [snapshot, setSnapshot] = useState(emptySnapshot);
  const [error, setError] = useState('');

  async function refresh() {
    try {
      setSnapshot(await api('/api/snapshot'));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    refresh();
    const socket = io();
    socket.on('snapshot', setSnapshot);
    socket.on('connect_error', () => setError('Temps reel indisponible.'));
    return () => socket.close();
  }, []);

  return { snapshot, error, refresh };
}

function remainingSeconds(state) {
  if (!state.timerRunning || !state.timerEndsAt) return 0;
  return Math.max(0, Math.ceil((new Date(state.timerEndsAt).getTime() - Date.now()) / 1000));
}

function cleanQuestionPrompt(prompt) {
  return String(prompt || '').replace(/^Equipe\s+\d+\s+-\s+/i, '');
}

function themeLabel(question) {
  const prompt = cleanQuestionPrompt(question?.prompt || '');
  const match = prompt.match(/^Theme\s*\d*\s*:\s*([^.]*)/i);
  return (match?.[1] || question?.theme || prompt || 'Theme').trim();
}

function cleanDrawingPrompt(prompt) {
  const value = String(prompt || '').trim();
  if (!value || /^a dessiner$/i.test(value) || /^à dessiner$/i.test(value)) return 'Consigne';
  return value;
}

function TimerDisplay({ state }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((value) => value + 1), 500);
    return () => clearInterval(id);
  }, []);
  const seconds = remainingSeconds(state) + tick * 0;
  const minutes = String(Math.floor(seconds / 60)).padStart(2, '0');
  const rest = String(seconds % 60).padStart(2, '0');
  return (
    <div className="timer-display">
      <AlarmClock size={22} />
      <span>{state.timerLabel || 'Timer'}</span>
      <strong>{minutes}:{rest}</strong>
    </div>
  );
}

function DrawingStage({ snapshot }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((value) => value + 1), 250);
    return () => clearInterval(id);
  }, []);
  const seconds = remainingSeconds(snapshot.state) + tick * 0;
  const minutes = String(Math.floor(seconds / 60)).padStart(2, '0');
  const rest = String(seconds % 60).padStart(2, '0');
  const isFinished = snapshot.state.publicMode === 'drawing-task' && snapshot.state.timerRunning && seconds === 0;
  const drawingIds = (snapshot.state.drawingTeamIds?.length
    ? snapshot.state.drawingTeamIds
    : snapshot.state.voteOptions?.map((option) => option.id) || []
  ).map(String);
  const teams = drawingIds
    .map((id) => snapshot.teams.find((team) => team.id === Number(id)))
    .filter(Boolean);
  const prompt = cleanDrawingPrompt(snapshot.state.drawingPrompt);

  return (
    <section className={`stage-card empty-stage drawing-stage ${isFinished ? 'is-finished' : ''}`}>
      <GameLogo />
      <span>{isFinished ? 'Fin de manche' : 'Mini-jeu'}</span>
      <h1>{isFinished ? 'Les pinceaux se posent' : snapshot.state.publicMode === 'drawing-task' ? (prompt || 'Consigne') : 'Le Duel des Illustrateurs'}</h1>
      {snapshot.state.publicMode !== 'drawing-task' && !!teams.length && (
        <div className="drawing-house-duel">
          {teams.map((team) => (
            <article key={team.id}>
              <TeamLogo team={team} />
              <strong>{team.name}</strong>
            </article>
          ))}
        </div>
      )}
      {snapshot.state.publicMode === 'drawing-task' && (
        <>
          <div className="drawing-countdown">{isFinished ? '00:00' : `${minutes}:${rest}`}</div>
        </>
      )}
    </section>
  );
}

function VoteQrScreen({ snapshot }) {
  const teams = (snapshot.state.drawingTeamIds || []).map(String)
    .map((id) => snapshot.teams.find((team) => team.id === Number(id)))
    .filter(Boolean);

  return (
    <section className="vote-qr-screen">
      <div>
        <span>Vote public</span>
        <h1>Choisissez votre champion</h1>
      </div>
      <div className="vote-qr-big">
        <QRCodeSVG value={`${window.location.origin}/vote`} size={260} />
      </div>
    </section>
  );
}

function VoteResultsScreen({ snapshot }) {
  const teams = (snapshot.state.drawingTeamIds || []).map(String)
    .map((id) => snapshot.teams.find((team) => team.id === Number(id)))
    .filter(Boolean);

  return (
    <section className="vote-results-screen">
      <div className="round-results-heading">
        <span>Vote public</span>
        <h1>Verdict du public</h1>
        {!!teams.length && (
          <div className="vote-house-duel">
            {teams.map((team) => (
              <article key={team.id}>
                <TeamLogo team={team} />
                <strong>{team.name}</strong>
              </article>
            ))}
          </div>
        )}
      </div>
      <VoteResults snapshot={snapshot} animated />
    </section>
  );
}

function RoundThreeScoreStrip({ teams, roundThreeTeamIds = [], editable = false, onAdjust }) {
  const selectedTeams = getRoundThreeTeams(teams, roundThreeTeamIds);

  if (!selectedTeams.length) return null;

  return (
    <section className="round-three-score-strip">
      {selectedTeams.map((team) => (
        <article key={team.id}>
          <TeamLogo team={team} compact />
          <strong>{team.name}</strong>
          {editable ? (
            <div className="round-three-score-stepper">
              <button onClick={() => onAdjust?.(team, -1)}><Minus size={16} /></button>
              <span>{team.score}</span>
              <button onClick={() => onAdjust?.(team, 1)}><Plus size={16} /></button>
            </div>
          ) : (
            <span>{team.score}</span>
          )}
        </article>
      ))}
    </section>
  );
}

function getRoundThreeTeams(teams, roundThreeTeamIds = []) {
  return (roundThreeTeamIds.length ? roundThreeTeamIds : teams.slice(0, 2).map((team) => team.id))
    .map((id) => teams.find((team) => team.id === Number(id)))
    .filter(Boolean)
    .slice(0, 2);
}

function StroopStage({ state, teams = [] }) {
  const teamIds = (state.stroopTeamIds?.length ? state.stroopTeamIds : teams.slice(0, 2).map((team) => team.id)).map(String);
  const selectedTeams = teamIds
    .map((id) => teams.find((team) => team.id === Number(id)))
    .filter(Boolean);
  const activeTeamId = String(state.stroopActiveTeamId || teamIds[0] || '');
  const activeTeam = selectedTeams.find((team) => String(team.id) === activeTeamId);
  const activeSlot = Math.max(0, selectedTeams.findIndex((team) => String(team.id) === activeTeamId));
  const progress = state.stroopProgress || {};
  const activeProgress = Math.min(Math.max(Number(progress[activeTeamId] || 0), 0), STROOP_PER_TEAM - 1);
  const index = activeSlot * STROOP_PER_TEAM + activeProgress;
  const page = String(index + 1).padStart(3, '0');
  const streaks = state.stroopStreaks || {};
  const bests = state.stroopBests || {};
  const isIntro = state.publicMode === 'stroop-intro';
  const isResults = state.publicMode === 'stroop-results';

  if (isIntro) {
    return (
      <section className="stage-card empty-stage round-intro-stage stroop-intro-stage">
        <div className="stroop-intro-card">
          <GameLogo />
          <span>MINI-JEU</span>
          <h1>L’Épreuve des Illusions</h1>
          {!!selectedTeams.length && (
            <div className="pool-intro-teams">
              {selectedTeams.map((team, teamIndex) => (
                <React.Fragment key={team.id}>
                  {teamIndex > 0 && <i>vs</i>}
                  <strong>{team.name}</strong>
                </React.Fragment>
              ))}
            </div>
          )}
        </div>
      </section>
    );
  }

  if (isResults) {
    return (
      <section className="round-results-screen stroop-results-screen">
        <div className="round-results-heading">
          <span>MINI-JEU</span>
          <h1>L’Épreuve des Illusions</h1>
        </div>
        <div className="stroop-results-grid">
          {selectedTeams.map((team) => (
            <article className={String(team.id) === activeTeamId ? 'active' : ''} key={team.id}>
              <TeamLogo team={team} />
              <strong>{team.name}</strong>
              <span>{streaks[team.id] || 0}</span>
              <em>points</em>
            </article>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="stroop-play-screen">
      <div className="stroop-play-bar">
        <span>MINI-JEU</span>
        <strong>{activeTeam?.name || 'Maison en attente'}</strong>
        <span>{activeProgress + 1}/{STROOP_PER_TEAM}</span>
      </div>
      <div className="stroop-viewer">
        {state.answerStatus === 'wrong' && <div className="stroop-error-overlay">Erreur</div>}
        <object
          key={page}
          data={`/stroop/page-${page}.pdf#toolbar=0&navpanes=0&scrollbar=0&view=Fit`}
          type="application/pdf"
        >
          <a href={`/stroop/page-${page}.pdf`} target="_blank">Afficher le visuel Stroop</a>
        </object>
      </div>
    </section>
  );
}

function QuestionStage({ state, teams = [] }) {
  const question = state.currentQuestion;
  const hideAnswerReveal = (question?.roundKey === 'round1' && question?.type === 'truefalse') || question?.roundKey === 'round2';
  const hideMaskedAnswer = question?.roundKey === 'round3';
  const poolTeams =
    state.poolKey === 'poule-1'
      ? teams.slice(0, 2)
      : state.poolKey === 'poule-2'
        ? teams.slice(2, 4)
        : ['team-1', 'team-2'].includes(state.poolKey)
          ? teams.slice(0, 2)
          : ['team-3', 'team-4'].includes(state.poolKey)
            ? teams.slice(2, 4)
            : [];
  if (!question) {
    if (state.roundKey === 'stroop') {
      return <StroopStage state={state} teams={teams} />;
    }

    if (state.roundKey === 'round2') {
      return (
          <section className="stage-card empty-stage round-two-stage">
          <GameLogo />
          <span>MANCHE 2</span>
          <h1>{state.publicMode === 'blank-question' ? 'En attente' : 'Le Champ des Connaissances'}</h1>
          <p>2 malus = elimination</p>
        </section>
      );
    }

    if (state.roundKey === 'round1') {
      if (state.publicMode === 'blank-question') {
        return (
          <section className="stage-card empty-stage blank-question-stage">
            <GameLogo />
            <span>L’Épreuve du Vrai</span>
            <h1>Question en attente</h1>
            {!!poolTeams.length && (
              <div className="blank-question-houses">
                {poolTeams.map((team) => (
                  <article key={team.id}>
                    <TeamLogo team={team} />
                    <strong>{team.name}</strong>
                  </article>
                ))}
              </div>
            )}
            <p>La regie prepare la prochaine question.</p>
          </section>
        );
      }

      if (state.poolKey === 'poule-1' || state.poolKey === 'poule-2') {
        return (
          <section className="stage-card empty-stage round-intro-stage pool-intro-stage">
            <GameLogo />
            <span>{state.poolKey === 'poule-1' ? 'Poule 1' : 'Poule 2'}</span>
            <h1>Prets ?</h1>
            {!!poolTeams.length && (
              <div className="pool-intro-teams">
                <strong>{poolTeams[0]?.name}</strong>
                <i>vs</i>
                <strong>{poolTeams[1]?.name}</strong>
              </div>
            )}
            <p>Vrai / Faux</p>
          </section>
        );
      }

      return (
        <section className="stage-card empty-stage round-intro-stage">
          <GameLogo />
          <span>MANCHE 1</span>
          <h1>L’Épreuve du Vrai</h1>
          <p>Vrai / Faux</p>
        </section>
      );
    }

    if (state.roundKey === 'round3') {
      const roundThreeTeamIds = (state.roundThreeTeamIds || []).map(String);
      const roundThreeTeams = (roundThreeTeamIds.length ? roundThreeTeamIds : teams.slice(0, 2).map((team) => String(team.id)))
        .map((id) => teams.find((team) => team.id === Number(id)))
        .filter(Boolean);

      if (state.publicMode === 'blank-question') {
        return (
          <section className="stage-card empty-stage blank-question-stage round-three-wait-stage">
            <GameLogo />
            <span>Les Joutes du Savoir</span>
            <h1>Question en attente</h1>
            {!!roundThreeTeams.length && (
              <div className="blank-question-houses">
                {roundThreeTeams.map((team) => (
                  <article key={team.id}>
                    <TeamLogo team={team} />
                    <strong>{team.name}</strong>
                  </article>
                ))}
              </div>
            )}
            <p>La regie prepare la prochaine question buzzer.</p>
          </section>
        );
      }

      return (
        <section className="stage-card empty-stage round-intro-stage round-three-intro-stage">
          <GameLogo />
          <span>MANCHE 3</span>
          <h1>Les Joutes du Savoir</h1>
          {!!roundThreeTeams.length && (
            <div className="pool-intro-teams">
              {roundThreeTeams.map((team, index) => (
                <React.Fragment key={team.id}>
                  {index > 0 && <i>vs</i>}
                  <strong>{team.name}</strong>
                </React.Fragment>
              ))}
            </div>
          )}
          <p>Quiz buzzer</p>
        </section>
      );
    }

    return (
      <section className="stage-card empty-stage">
        <GameLogo />
        <h1>Live Quiz</h1>
        <p>La regie prepare la prochaine sequence.</p>
      </section>
    );
  }

  return (
    <section className={`stage-card question-stage type-${question.type} round-${question.roundKey}`}>
      {state.publicMode !== 'question' && (
        <div className="stage-meta">
          <span>{rounds.find((round) => round.key === question.roundKey)?.label || question.roundKey}</span>
          <span>#{question.order || question.id}</span>
          <span>{question.theme || question.type}</span>
        </div>
      )}
      <h1>{question.roundKey === 'round2' ? themeLabel(question) : cleanQuestionPrompt(question.prompt)}</h1>
      {(question.mediaUrl || question.mediaUrlB) && (
        <div className={question.mediaUrlB ? 'media-compare' : 'media-single'}>
          {question.mediaUrl && (
            <img
              src={question.mediaUrl}
              alt=""
              style={{
                filter: question.type === 'blur' && !state.revealAnswer ? `blur(${question.blurLevel}px)` : 'none',
                transform: question.type === 'zoom' && !state.revealAnswer ? 'scale(1.65)' : 'scale(1)'
              }}
            />
          )}
          {question.mediaUrlB && <img src={question.mediaUrlB} alt="" />}
        </div>
      )}
          {!!question.options?.length && (
            <div className="answer-options">
              {question.options.map((option) => {
                const isTrueFalseReveal = state.revealAnswer && question.type === 'truefalse';
                const isRoundThreeReveal = state.revealAnswer && question.roundKey === 'round3';
                const isCorrect = option.trim().toLowerCase() === String(question.answer || '').trim().toLowerCase();
                const correctAnswerIsFalse = String(question.answer || '').trim().toLowerCase() === 'faux';
                return (
                  <span
                    className={(isTrueFalseReveal || isRoundThreeReveal) && isCorrect ? (isTrueFalseReveal && correctAnswerIsFalse ? 'option-false-correct' : 'option-correct') : ''}
                    key={option}
                  >
                    {option}
                  </span>
                );
              })}
            </div>
          )}
          {!hideAnswerReveal && !(hideMaskedAnswer && !state.revealAnswer) && (
            <div className={`answer-reveal ${state.revealAnswer ? 'visible' : ''} ${state.answerStatus ? `status-${state.answerStatus}` : ''}`}>
              {state.revealAnswer ? `Reponse : ${question.answer || 'reponse libre'}` : 'Reponse masquee'}
            </div>
          )}
    </section>
  );
}

function Scoreboard({ teams, roundKey, poolKey, roundTwoTeamIds = [], roundThreeTeamIds = [] }) {
  const isRoundOne = roundKey === 'round1';
  const isRoundTwo = roundKey === 'round2';
  const isRoundThree = roundKey === 'round3';
  const roundOnePools = {
    'poule-1': { label: 'Poule 1', teams: teams.slice(0, 2) },
    'poule-2': { label: 'Poule 2', teams: teams.slice(2, 4) },
    'team-1': { label: 'Poule 1', teams: teams.slice(0, 2) },
    'team-2': { label: 'Poule 1', teams: teams.slice(0, 2) },
    'team-3': { label: 'Poule 2', teams: teams.slice(2, 4) },
    'team-4': { label: 'Poule 2', teams: teams.slice(2, 4) }
  };
  const activePool = roundOnePools[poolKey] || null;

  if (isRoundOne && activePool) {
    return (
      <section className="round-one-mini-score">
        <div className="mini-score-teams">
          {activePool.teams.map((team) => (
            <div className={`mini-score-team ${team.qualified ? 'qualified' : ''}`} key={team.id}>
              <TeamLogo team={team} compact />
              <strong>{team.name}</strong>
              <span>{team.score}</span>
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (isRoundTwo) {
    const selectedTeams = roundTwoTeamIds.length
      ? roundTwoTeamIds.map((id) => teams.find((team) => team.id === Number(id))).filter(Boolean)
      : teams.slice(0, 3);
    return (
      <section className="round-two-mini-score">
        {selectedTeams.map((team) => (
          <div className={`round-two-mini-team ${team.eliminated ? 'eliminated' : ''}`} key={team.id}>
            <TeamLogo team={team} compact />
            <strong>{team.name}</strong>
            <span>{team.malus}/2 malus</span>
            {team.eliminated && <em>Eliminee</em>}
          </div>
        ))}
      </section>
    );
  }

  if (isRoundThree) {
    return <RoundThreeScoreStrip teams={teams} roundThreeTeamIds={roundThreeTeamIds} />;
  }

  return (
    <section className={`scoreboard ${isRoundOne ? 'round-one-scoreboard' : ''}`}>
      <div className="section-title">
        <Trophy size={18} />
        <h2>{isRoundOne ? 'Scores par poule' : 'Equipes'}</h2>
      </div>
      {isRoundOne ? (
        <div className="pool-duel-grid">
          {roundOnePools.map((pool) => (
            <article className="pool-duel-card" key={pool.label}>
              <h3>{pool.label}</h3>
              <div className="pool-duel-teams">
                {pool.teams.map((team) => (
                  <div className={`pool-team-score ${team.qualified ? 'qualified' : ''}`} key={team.id}>
                    <TeamLogo team={team} compact />
                    <strong>{team.name}</strong>
                    <div className="round-one-score-line">
                      <b>{team.score}</b>
                      <small>pts</small>
                    </div>
                    {team.qualified && <em>Qualifiee</em>}
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="team-grid">
          {teams.map((team) => (
            <article className={`team-card ${team.eliminated ? 'out' : ''} ${team.qualified ? 'qualified' : ''}`} key={team.id}>
              <TeamLogo team={team} compact />
              <div>
                <strong>{team.name}</strong>
                <span>{[team.playerOne, team.playerTwo].filter(Boolean).join(' + ') || 'Binome'}</span>
              </div>
              <div className="score-line">
                <b>{team.score}</b><small>pts</small>
                <b>{team.malus}</b><small>malus</small>
              </div>
              {team.qualified && <em>Qualifiee</em>}
              {team.eliminated && <em>Eliminee</em>}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function RoundOneResultsScreen({ teams }) {
  const pools = [
    { label: 'Poule 1', teams: teams.slice(0, 2) },
    { label: 'Poule 2', teams: teams.slice(2, 4) }
  ];

  return (
    <section className="round-results-screen">
      <div className="round-results-heading">
        <span>MANCHE 1</span>
        <h1>Resultats des poules</h1>
      </div>
      <div className="round-results-pools">
        {pools.map((pool) => (
          <article className="round-results-pool" key={pool.label}>
            <h2>{pool.label}</h2>
            <div className="round-results-teams">
              {pool.teams.map((team) => (
                <div className={`round-results-team ${team.qualified ? 'qualified' : ''}`} key={team.id}>
                  <TeamLogo team={team} />
                  <strong>{team.name}</strong>
                  <span>{team.score} pts</span>
                  <em>{team.qualified ? 'Qualifiee' : 'Non qualifiee'}</em>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function RoundTwoResultsScreen({ teams, roundTwoTeamIds = [] }) {
  const selectedTeams = roundTwoTeamIds.length
    ? roundTwoTeamIds.map((id) => teams.find((team) => team.id === Number(id))).filter(Boolean)
    : teams.slice(0, 3);

  return (
    <section className="round-results-screen round-two-results-screen">
      <div className="round-results-heading">
        <span>MANCHE 2</span>
        <h1>Malus des equipes</h1>
      </div>
      <div className="round-two-results-grid">
        {selectedTeams.map((team) => (
          <article className={`round-two-result-team ${team.eliminated ? 'eliminated' : ''}`} key={team.id}>
            <TeamLogo team={team} />
            <strong>{team.name}</strong>
            <span>{team.malus}/2</span>
            <em>{team.eliminated ? 'Eliminee' : 'Encore en jeu'}</em>
          </article>
        ))}
      </div>
    </section>
  );
}

function VoteResults({ snapshot, animated = false }) {
  const total = snapshot.votes.reduce((sum, vote) => sum + vote.count, 0);
  if (!snapshot.state.voteOptions?.length) return null;
  return (
    <section className={`vote-results ${animated ? 'animated' : ''}`}>
      <h2>{snapshot.state.voteTitle || 'Vote du public'}</h2>
      {snapshot.state.voteOptions.map((option) => {
        const count = snapshot.votes.find((vote) => vote.option_id === option.id)?.count || 0;
        const percent = total ? Math.round((count / total) * 100) : 0;
        return (
          <div className="vote-bar" key={option.id}>
            <span>{option.label}</span>
            <div><i style={{ width: `${percent}%` }} /></div>
            <b>{percent}%</b>
          </div>
        );
      })}
    </section>
  );
}

function WelcomePosterScreen() {
  return (
    <section className="welcome-poster-screen">
      <div className="welcome-poster-frame">
        <header className="welcome-poster-title">
          <img src="/home-1.svg" alt="Oyez Oyez" />
          <img className="welcome-poster-label" src="/home-2.svg" alt="Desarts et Delettres" />
        </header>

        <div className="welcome-screen-body">
          <div className="welcome-poster-illustration">
            <img src="/home-4.svg" alt="Illustration du quiz" />
          </div>

          <div className="welcome-screen-content">
            <p className="welcome-date">03 / 06</p>
            <h1>Grand quiz</h1>
            <div className="welcome-simple-line" aria-hidden="true" />
          </div>
        </div>
      </div>
    </section>
  );
}

function getDragonPlayers(state = {}) {
  const names = Array.isArray(state.dragonPlayers) && state.dragonPlayers.length
    ? state.dragonPlayers
    : ['Participant 1', 'Participant 2', 'Participant 3'];
  return [0, 1, 2].map((index) => ({
    id: index + 1,
    name: names[index]?.trim() || `Participant ${index + 1}`,
    seriesLabel: `Série ${index + 1}`,
    duration: index === 2 ? 45 : 60
  }));
}

function DragonStage({ snapshot }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((value) => value + 1), 250);
    return () => clearInterval(id);
  }, []);
  const seconds = remainingSeconds(snapshot.state) + tick * 0;
  const minutes = String(Math.floor(seconds / 60)).padStart(2, '0');
  const rest = String(seconds % 60).padStart(2, '0');
  const players = getDragonPlayers(snapshot.state);
  const activePlayer = players.find((player) => player.id === Number(snapshot.state.dragonActivePlayerId)) || players[0];
  const question = snapshot.state.currentQuestion;

  if (snapshot.state.publicMode === 'dragon-results') {
    return <DragonResultsScreen snapshot={snapshot} />;
  }

  if (snapshot.state.publicMode === 'dragon-question' && question) {
    return (
      <section className="stage-card empty-stage dragon-question-stage">
        <GameLogo />
        <span>L’Épreuve du Dragon</span>
        <strong className="dragon-active-player">{activePlayer?.name || 'Joueur'}</strong>
        <h1>{cleanQuestionPrompt(question.prompt)}</h1>
        <div className="dragon-countdown">{minutes}:{rest}</div>
      </section>
    );
  }

  if (snapshot.state.publicMode === 'dragon-player-done') {
    return (
      <section className="stage-card empty-stage dragon-question-stage">
        <GameLogo />
        <span>L’Épreuve du Dragon</span>
        <strong className="dragon-active-player">{activePlayer?.name || 'Joueur'}</strong>
        <h1>Série terminée</h1>
        <p>La regie prepare le passage suivant.</p>
      </section>
    );
  }

  return (
    <section className="stage-card empty-stage round-intro-stage dragon-intro-stage">
      <GameLogo />
      <span>MANCHE 4</span>
      <h1>L’Épreuve du Dragon</h1>
      {!!players.length && (
        <div className="dragon-player-line">
          {players.map((player) => (
            <strong key={player.id}>{player.name}</strong>
          ))}
        </div>
      )}
      <p>2 séries de 1 minute - 1 série de 45 secondes</p>
    </section>
  );
}

function DragonResultsScreen({ snapshot }) {
  const questions = snapshot.questions.filter((question) => question.roundKey === 'dragon');
  const players = getDragonPlayers(snapshot.state);
  const answers = snapshot.state.dragonAnswers || {};
  const answeredQuestions = questions.filter((question) => players.some((player) => answers[player.id]?.[question.id]));
  const revealCount = Math.max(0, Number(snapshot.state.dragonRevealCount || 0));
  const revealPool = answeredQuestions.length ? answeredQuestions : questions;
  const revealedQuestions = revealPool.slice(0, revealCount);
  const currentRevealQuestion = revealCount > 0 ? revealPool[Math.min(revealCount - 1, Math.max(0, revealPool.length - 1))] : null;
  const revealedScores = players.reduce((acc, player) => {
    acc[player.id] = revealedQuestions.reduce((total, question) => {
      return total + (answers[player.id]?.[question.id] === 'correct' ? 1 : 0);
    }, 0);
    return acc;
  }, {});

  return (
    <section className="round-results-screen dragon-results-screen">
      <div className="round-results-heading">
        <span>Manche 4</span>
        <h1>Scores du Dragon</h1>
      </div>
      <div className="dragon-current-reveal">
        <span>{currentRevealQuestion ? `Question ${Math.min(revealCount, revealPool.length)}` : 'En attente'}</span>
        <strong>{currentRevealQuestion ? cleanQuestionPrompt(currentRevealQuestion.prompt) : 'Prêt à révéler question par question'}</strong>
        <em>{currentRevealQuestion?.answer ? `Réponse : ${currentRevealQuestion.answer}` : 'Réponse : -'}</em>
        {currentRevealQuestion && (
          <div className="dragon-current-statuses">
            {players.map((player) => {
              const status = answers[player.id]?.[currentRevealQuestion.id] || '';
              return (
                <article key={player.id}>
                  <small>{player.name}</small>
                  <b className={`dragon-answer-status status-${status || 'empty'}`}>
                    {status === 'correct' ? 'Juste' : status === 'wrong' ? 'Faux' : status === 'skipped' ? 'Passé' : '-'}
                  </b>
                </article>
              );
            })}
          </div>
        )}
      </div>
      <div className="dragon-score-reveal">
        {players.map((player) => (
          <article key={player.id}>
            <strong>{player.name}</strong>
            <span>{revealedScores[player.id] || 0}</span>
          </article>
        ))}
      </div>
      <p className="dragon-reveal-progress">{Math.min(revealCount, revealPool.length)} / {revealPool.length || 0} questions révélées</p>
    </section>
  );
}

function PreRoundStage({ snapshot }) {
  const isFirst = snapshot.state.roundKey === 'premanche1';
  const teams = getPreRoundTeams(snapshot.state);
  const sounds = snapshot.state.preRoundSounds || [];
  const visuals = snapshot.state.preRoundVisuals || [];
  const currentSound = sounds.find((sound) => sound.id === snapshot.state.preRoundCurrentSoundId);
  const currentVisual = visuals.find((visual) => visual.id === snapshot.state.preRoundCurrentVisualId);
  const preRoundBuzzWinnerId = snapshot.state.preRoundBuzzWinnerId || snapshot.state.buzzWinnerTeamId;
  const buzzWinner = teams.find((team) => Number(team.id) === Number(preRoundBuzzWinnerId));
  const preOneQualifiedIds = (snapshot.state.preRoundOneQualifiedIds || []).map(String);
  const preTwoQualifiedIds = (snapshot.state.preRoundTwoQualifiedIds || []).map(String);
  const qualifiedIds = isFirst ? preOneQualifiedIds : preTwoQualifiedIds;
  const visibleTeams = isFirst
    ? teams
    : teams.filter((team) => preOneQualifiedIds.includes(team.id)).slice(0, 7);
  const scores = isFirst ? (snapshot.state.preRoundOneScores || {}) : (snapshot.state.preRoundTwoScores || {});
  const isScores = snapshot.state.publicMode === 'premanche-scores';
  const isQrScreen = snapshot.state.publicMode === 'premanche-qr';
  const targetCount = isFirst ? 7 : 4;
  const title = isFirst ? 'Reconnaissance sonore' : 'Reconnaissance visuelle';
  const introText = isFirst ? '10 équipes - 7 qualifiés à 2 points' : '7 équipes - 4 qualifiés à 2 points';

  if (isQrScreen) {
    return (
      <section className="round-results-screen preround-results-screen preround-qr-screen">
        <div className="round-results-heading">
          <span>{isFirst ? 'Prémanche 1' : 'Prémanche 2'}</span>
          <h1>QR codes des buzzers</h1>
        </div>
        <div className="preround-public-qr-grid">
          {visibleTeams.map((team) => (
            <article key={team.id}>
              <QRCodeSVG value={`${window.location.origin}/buzzer/${team.id}`} size={132} />
              <strong>{team.name}</strong>
              <span>Buzzer {team.id}</span>
            </article>
          ))}
        </div>
      </section>
    );
  }

  if (!isScores) {
    return (
      <section className="stage-card empty-stage round-intro-stage preround-stage">
        <GameLogo />
        <span>{isFirst ? 'PRÉMANCHE 1' : 'PRÉMANCHE 2'}</span>
        <h1>{title}</h1>
        <p>{introText}</p>
        {isFirst && currentSound && (
          <div className="preround-public-audio">
            <strong>Écoutez bien</strong>
            <AutoPlayAudio sound={currentSound} />
          </div>
        )}
        {!isFirst && currentVisual && (
          <div className="preround-public-visual intro">
            <img src={currentVisual.url} alt="" />
          </div>
        )}
        {buzzWinner && <div className="preround-buzz-winner">Premier buzz : {buzzWinner.name}</div>}
      </section>
    );
  }

  return (
    <section className="round-results-screen preround-results-screen">
      <div className="round-results-heading">
        <span>{isFirst ? 'Prémanche 1' : 'Prémanche 2'}</span>
        <h1>{title}</h1>
      </div>
      {isFirst && currentSound && (
        <div className="preround-public-audio compact">
          <strong>Écoutez bien</strong>
          <AutoPlayAudio sound={currentSound} />
        </div>
      )}
      {!isFirst && currentVisual && (
        <div className="preround-public-visual">
          <img src={currentVisual.url} alt="" />
        </div>
      )}
      {buzzWinner && <div className="preround-buzz-winner compact">Premier buzz : {buzzWinner.name}</div>}
      <div className="preround-score-grid">
        {visibleTeams.map((team) => {
          const score = Number(scores[team.id] || 0);
          const qualified = qualifiedIds.includes(team.id);
          return (
            <article className={qualified ? 'is-qualified' : ''} key={team.id}>
              <strong>{team.name}</strong>
              <span>{score}</span>
              <em>{qualified ? 'Qualifié' : `${Math.max(0, 2 - score)} point${Math.max(0, 2 - score) > 1 ? 's' : ''} restant${Math.max(0, 2 - score) > 1 ? 's' : ''}`}</em>
            </article>
          );
        })}
      </div>
      <p className="preround-qualified-count">{qualifiedIds.length}/{targetCount} qualifiés</p>
    </section>
  );
}

function PublicScreen({ snapshot }) {
  const winner = snapshot.teams.find((team) => team.id === snapshot.state.buzzWinnerTeamId);
  const origin = window.location.origin;
  const showVotePanel = snapshot.state.publicMode === 'vote';
  const showVoteQr = showVotePanel && snapshot.state.publicQrVisible;
  const hideTimer = snapshot.state.roundKey === 'round1' || snapshot.state.roundKey === 'stroop' || snapshot.state.roundKey === 'round2' || snapshot.state.roundKey === 'drawing';
  const isRoundOneIntro = snapshot.state.roundKey === 'round1' && !snapshot.state.currentQuestion && !snapshot.state.poolKey;
  const isRoundThreeIntro = snapshot.state.roundKey === 'round3' && !snapshot.state.currentQuestion && snapshot.state.publicMode !== 'blank-question';
  const isRoundThreeWaiting = snapshot.state.roundKey === 'round3' && !snapshot.state.currentQuestion && snapshot.state.publicMode === 'blank-question';
  const isStroopScreen = snapshot.state.roundKey === 'stroop';
  const isRoundOneResults = snapshot.state.publicMode === 'round1-results';
  const isRoundTwoResults = snapshot.state.publicMode === 'round2-results';
  const isDrawingScreen = snapshot.state.roundKey === 'drawing' && ['drawing-intro', 'drawing-task'].includes(snapshot.state.publicMode);
  const isVoteQrScreen = snapshot.state.roundKey === 'drawing' && snapshot.state.publicMode === 'vote-qr';
  const isVoteResultsScreen = snapshot.state.roundKey === 'drawing' && snapshot.state.publicMode === 'vote-results';
  const isWelcomePoster = snapshot.state.roundKey === 'welcome' && snapshot.state.publicMode === 'welcome-poster';
  const isPreRoundScreen = ['premanche1', 'premanche2'].includes(snapshot.state.roundKey);
  const isDragonScreen = snapshot.state.roundKey === 'dragon';
  const isDragonResults = snapshot.state.roundKey === 'dragon' && snapshot.state.publicMode === 'dragon-results';
  const roundTwoTeamIds = snapshot.state.roundTwoTeamIds || [];
  const roundThreeTeamIds = snapshot.state.roundThreeTeamIds || [];
  const isRoundOneEmptyScreen = snapshot.state.roundKey === 'round1' && !snapshot.state.currentQuestion;

  return (
    <main className={`screen-layout ${isRoundOneIntro || isRoundThreeIntro || isRoundThreeWaiting || isWelcomePoster || isStroopScreen || isPreRoundScreen || isDragonScreen ? 'intro-only-screen' : ''}`}>
      {!isWelcomePoster && !isStroopScreen && !isPreRoundScreen && !isDragonScreen && !isRoundOneIntro && !isRoundThreeIntro && !isRoundThreeWaiting && !isRoundOneResults && !isRoundTwoResults && !isVoteQrScreen && !isVoteResultsScreen && (
        <header className="screen-header">
          <div className="brand-mark">Quiz</div>
          {!hideTimer && <TimerDisplay state={snapshot.state} />}
        </header>
      )}
      {isWelcomePoster ? (
        <WelcomePosterScreen />
      ) : isPreRoundScreen ? (
        <PreRoundStage snapshot={snapshot} />
      ) : isRoundOneResults ? (
        <RoundOneResultsScreen teams={snapshot.teams} />
      ) : isRoundTwoResults ? (
        <RoundTwoResultsScreen teams={snapshot.teams} roundTwoTeamIds={roundTwoTeamIds} />
      ) : isVoteQrScreen ? (
        <VoteQrScreen snapshot={snapshot} />
      ) : isVoteResultsScreen ? (
        <VoteResultsScreen snapshot={snapshot} />
      ) : isDragonScreen ? (
        <DragonStage snapshot={snapshot} />
      ) : isDrawingScreen ? (
        <DrawingStage snapshot={snapshot} />
      ) : (
        <QuestionStage state={snapshot.state} teams={snapshot.teams} />
      )}
      {winner && snapshot.state.roundKey === 'round3' && <div className="buzz-banner"><Radio size={26} /> {winner.name} a buzze en premier</div>}
      {showVotePanel && (
        <div className={`vote-public-zone ${showVoteQr ? '' : 'results-only'}`}>
          {showVoteQr && (
            <div className="public-qr-card">
              <QRCodeSVG value={`${origin}/vote`} size={128} />
              <span>Vote public</span>
            </div>
          )}
          <VoteResults snapshot={snapshot} />
        </div>
      )}
      {!isWelcomePoster && !isPreRoundScreen && !isStroopScreen && !isDragonScreen && !isDragonResults && !isRoundOneIntro && !isRoundThreeIntro && !isRoundThreeWaiting && !isRoundOneEmptyScreen && !isRoundOneResults && !isRoundTwoResults && !isDrawingScreen && !isVoteQrScreen && !isVoteResultsScreen && <Scoreboard teams={snapshot.teams} roundKey={snapshot.state.roundKey} poolKey={snapshot.state.poolKey} roundTwoTeamIds={roundTwoTeamIds} roundThreeTeamIds={roundThreeTeamIds} />}
    </main>
  );
}

function Login({ refresh }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault();
    try {
      const result = await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password }) });
      localStorage.setItem('adminToken', result.token);
      refresh();
      window.location.reload();
    } catch (err) {
      setError(err.message);
    }
  }
  return (
    <main className="admin-login">
      <form className="login-card" onSubmit={submit}>
        <Lock size={30} />
        <h1>Regie admin</h1>
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Mot de passe" />
        <button><Shield size={17} /> Entrer</button>
        {error && <p className="error">{error}</p>}
      </form>
    </main>
  );
}

function PreRoundPanel({ snapshot, step }) {
  const isFirst = step === 1;
  const teams = getPreRoundTeams(snapshot.state);
  const preOneQualifiedIds = (snapshot.state.preRoundOneQualifiedIds || []).map(String);
  const preTwoQualifiedIds = (snapshot.state.preRoundTwoQualifiedIds || []).map(String);
  const qualifiedIds = isFirst ? preOneQualifiedIds : preTwoQualifiedIds;
  const visibleTeams = isFirst ? teams : teams.filter((team) => preOneQualifiedIds.includes(team.id)).slice(0, 7);
  const scores = isFirst ? (snapshot.state.preRoundOneScores || {}) : (snapshot.state.preRoundTwoScores || {});
  const sounds = snapshot.state.preRoundSounds || [];
  const visuals = snapshot.state.preRoundVisuals || [];
  const currentSoundId = snapshot.state.preRoundCurrentSoundId || '';
  const currentVisualId = snapshot.state.preRoundCurrentVisualId || '';
  const preRoundBuzzWinnerId = snapshot.state.preRoundBuzzWinnerId || snapshot.state.buzzWinnerTeamId;
  const buzzWinner = teams.find((team) => Number(team.id) === Number(preRoundBuzzWinnerId));
  const targetCount = isFirst ? 7 : 4;
  const title = isFirst ? 'PRÉMANCHE 1 - Reconnaissance sonore' : 'PRÉMANCHE 2 - Reconnaissance visuelle';

  async function importAudioFiles(fileList) {
    const audioExtensions = /\.(mp3|wav|m4a|aac|ogg|webm|flac)$/i;
    const selectedFiles = Array.from(fileList || []).filter((file) => file.type.startsWith('audio/') || audioExtensions.test(file.name));
    if (!selectedFiles.length) return;
    const files = await Promise.all(selectedFiles.map(async (file) => ({
      name: file.name,
      type: file.type,
      data: await readFileAsDataUrl(file)
    })));
    await api('/api/audio/import', {
      method: 'POST',
      body: JSON.stringify({ files })
    });
  }

  async function importVisualFiles(fileList) {
    const imageExtensions = /\.(png|jpe?g|webp|gif|svg|avif)$/i;
    const selectedFiles = Array.from(fileList || []).filter((file) => file.type.startsWith('image/') || imageExtensions.test(file.name));
    if (!selectedFiles.length) return;
    const files = await Promise.all(selectedFiles.map(async (file) => ({
      name: file.name,
      type: file.type,
      data: await readFileAsDataUrl(file)
    })));
    await api('/api/visual/import', {
      method: 'POST',
      body: JSON.stringify({ files })
    });
  }

  async function showPreRound(mode = 'premanche-intro') {
    await api('/api/game/state', {
      method: 'POST',
      body: JSON.stringify({
        roundKey: isFirst ? 'premanche1' : 'premanche2',
        phase: isFirst ? 'premanche1' : 'premanche2',
        publicMode: mode,
        currentQuestionId: null,
        revealAnswer: false,
        answerStatus: '',
        poolKey: '',
        preRoundCurrentSoundId: '',
        preRoundCurrentVisualId: '',
        publicQrVisible: false
      })
    });
  }

  async function updateNames(index, value) {
    const nextNames = teams.map((team) => team.name);
    nextNames[index] = value;
    await api('/api/game/state', {
      method: 'POST',
      body: JSON.stringify({ preRoundTeamNames: nextNames })
    });
  }

  async function adjustScore(teamId, delta) {
    const key = String(teamId);
    const nextScores = {
      ...scores,
      [key]: Math.max(0, Number(scores[key] || 0) + delta)
    };
    const body = isFirst
      ? { preRoundOneScores: nextScores }
      : { preRoundTwoScores: nextScores };

    if (isFirst) {
      let nextQualified = qualifiedIds.filter((id) => Number(nextScores[id] || 0) >= 2);
      if (nextScores[key] >= 2 && !nextQualified.includes(key) && nextQualified.length < 7) {
        nextQualified = [...nextQualified, key];
      }
      body.preRoundOneQualifiedIds = nextQualified.slice(0, 7);
    } else {
      let nextQualified = qualifiedIds.filter((id) => Number(nextScores[id] || 0) >= 2);
      if (nextScores[key] >= 2 && !nextQualified.includes(key) && nextQualified.length < 4) {
        nextQualified = [...nextQualified, key];
      }
      body.preRoundTwoQualifiedIds = nextQualified.slice(0, 4);
    }

    await api('/api/game/state', {
      method: 'POST',
      body: JSON.stringify(body)
    });
  }

  async function resetPreRound() {
    await api('/api/game/state', {
      method: 'POST',
      body: JSON.stringify(isFirst
        ? { preRoundOneScores: {}, preRoundOneQualifiedIds: [] }
        : { preRoundTwoScores: {}, preRoundTwoQualifiedIds: [], preRoundCurrentVisualId: '' })
    });
  }

  async function launchSound(soundId) {
    await api('/api/buzzer/reset', { method: 'POST' });
    await api('/api/game/state', {
      method: 'POST',
      body: JSON.stringify({
        roundKey: 'premanche1',
        phase: 'premanche1',
        publicMode: 'premanche-scores',
        preRoundCurrentSoundId: soundId,
        preRoundCurrentVisualId: '',
        preRoundRejectedBuzzIds: []
      })
    });
  }

  async function launchVisual(visualId) {
    await api('/api/buzzer/reset', { method: 'POST' });
    await api('/api/game/state', {
      method: 'POST',
      body: JSON.stringify({
        roundKey: 'premanche2',
        phase: 'premanche2',
        publicMode: 'premanche-scores',
        preRoundCurrentSoundId: '',
        preRoundCurrentVisualId: visualId,
        preRoundRejectedBuzzIds: []
      })
    });
  }

  async function validatePreRoundBuzz(isCorrect) {
    if (!buzzWinner) return;
    if (isCorrect) {
      await adjustScore(buzzWinner.id, 1);
      await api('/api/buzzer/reset', { method: 'POST' });
      await api('/api/game/state', {
        method: 'POST',
        body: JSON.stringify(isFirst ? { preRoundCurrentSoundId: '' } : { preRoundCurrentVisualId: '' })
      });
      return;
    }

    const rejectedIds = Array.from(new Set([...(snapshot.state.preRoundRejectedBuzzIds || []).map(String), String(buzzWinner.id)]));
    await api('/api/game/state', {
      method: 'POST',
      body: JSON.stringify({
        buzzLocked: false,
        buzzWinnerTeamId: null,
        preRoundBuzzWinnerId: '',
        preRoundRejectedBuzzIds: rejectedIds
      })
    });
  }

  return (
    <section className="admin-panel wide preround-panel">
      <div className="section-title"><Radio size={18} /><h2>{title}</h2></div>
      <p className="muted">
        {isFirst
          ? 'Ajoute 1 point quand une équipe reconnaît un son. Les 7 premières équipes qui atteignent 2 points sont qualifiées.'
          : 'Lance un visuel, les équipes buzzent, puis les 4 premières équipes qui atteignent 2 points sont qualifiées.'}
      </p>
      <div className="button-row">
        <button onClick={() => showPreRound('premanche-intro')}>Afficher lancement</button>
        <button onClick={() => showPreRound('premanche-scores')}>Afficher scores</button>
        <button onClick={() => showPreRound('premanche-qr')}>Afficher QR buzzers</button>
        <button className="danger" onClick={resetPreRound}>Remettre cette prémanche à zéro</button>
      </div>

      {isFirst ? (
        <div className="preround-sound-panel">
          <strong>Sons de reconnaissance</strong>
          <p className="muted">Quand tu cliques sur Lancer, tu restes sur l'écran des scores, le son part et les buzzers sont debloques.</p>
          <label className="file-button">
            Importer des sons
            <input type="file" accept="audio/*" multiple onChange={(event) => importAudioFiles(event.target.files)} />
          </label>
          <div className="preround-sound-list">
            {sounds.map((sound) => (
              <article className={currentSoundId === sound.id ? 'is-active-sound' : ''} key={sound.id}>
                <span>{sound.name}</span>
                <audio src={sound.url} controls />
                <button onClick={() => launchSound(sound.id)}>Lancer</button>
              </article>
            ))}
            {!sounds.length && <p className="muted">Importe tes fichiers audio ici pour pouvoir choisir le son à lancer.</p>}
          </div>
        </div>
      ) : (
        <div className="preround-sound-panel preround-visual-panel">
          <strong>Visuels à reconnaître</strong>
          <p className="muted">Importe tes PNG, JPG, SVG, GIF ou WebP, puis lance le visuel choisi. Les buzzers s'ouvrent automatiquement.</p>
          <label className="file-button">
            Importer des visuels
            <input type="file" accept="image/*,.svg,.png,.jpg,.jpeg,.webp,.gif,.avif" multiple onChange={(event) => importVisualFiles(event.target.files)} />
          </label>
          <div className="preround-sound-list preround-visual-list">
            {visuals.map((visual) => (
              <article className={currentVisualId === visual.id ? 'is-active-sound' : ''} key={visual.id}>
                <img src={visual.url} alt="" />
                <span>{visual.name}</span>
                <button onClick={() => launchVisual(visual.id)}>Lancer</button>
              </article>
            ))}
            {!visuals.length && <p className="muted">Importe tes visuels ici pour pouvoir choisir l'image à afficher.</p>}
          </div>
        </div>
      )}

      <div className="preround-buzzer-panel">
        <strong>Buzzers rapidité</strong>
        <div className="button-row">
          <button onClick={() => api('/api/buzzer/reset', { method: 'POST' })}>Débloquer buzzers</button>
        </div>
        {buzzWinner ? (
          <div className="buzz-validation-box">
            <strong>Premier buzz : {buzzWinner.name}</strong>
            <p>Valide la réponse. Si elle est fausse, les autres équipes peuvent rebuzzer.</p>
            <div className="button-row">
              <button onClick={() => validatePreRoundBuzz(true)}><Check size={17} /> Réponse juste</button>
              <button className="danger" onClick={() => validatePreRoundBuzz(false)}><X size={17} /> Réponse fausse</button>
            </div>
          </div>
        ) : (
          <p className="muted">Aucun buzz pour le moment. Lance {isFirst ? 'un son' : 'un visuel'} pour ouvrir les buzzers.</p>
        )}
        <div className="preround-buzzer-grid">
          {visibleTeams.map((team) => (
            <article key={team.id}>
              <QRCodeSVG value={`${window.location.origin}/buzzer/${team.id}`} size={72} />
              <strong>{team.name}</strong>
              <small>/buzzer/{team.id}</small>
            </article>
          ))}
        </div>
      </div>

      {isFirst && (
        <div className="preround-name-grid">
          {teams.map((team, index) => (
            <label key={team.id}>
              <span>Equipe {index + 1}</span>
              <input value={team.name} onChange={(event) => updateNames(index, event.target.value)} />
            </label>
          ))}
        </div>
      )}

      <div className="preround-admin-list">
        {visibleTeams.map((team) => {
          const score = Number(scores[team.id] || 0);
          const qualified = qualifiedIds.includes(team.id);
          return (
            <article className={qualified ? 'is-qualified' : ''} key={team.id}>
              <strong>{team.name}</strong>
              <span>{score} point{score > 1 ? 's' : ''}</span>
              <em>{qualified ? 'Qualifié' : 'Objectif : 2 points'}</em>
              <div>
                <button onClick={() => adjustScore(team.id, -1)}><Minus size={16} /></button>
                <button onClick={() => adjustScore(team.id, 1)}><Plus size={16} /></button>
              </div>
            </article>
          );
        })}
        {!visibleTeams.length && <p className="muted">Aucune équipe qualifiée pour l'instant.</p>}
      </div>
      <p className="success">{qualifiedIds.length}/{targetCount} équipes qualifiées{isFirst ? ' pour la deuxième prémanche' : ''}.</p>
    </section>
  );
}

function questionMatchesTeam(question, team) {
  const pool = String(question.poolKey || '').trim().toLowerCase();
  if (!pool || !team) return false;
  const accepted = [
    team.code,
    `team-${team.id}`,
    `equipe-${team.id}`,
    `équipe-${team.id}`,
    `equipe ${team.id}`,
    `équipe ${team.id}`,
    team.name
  ].map((value) => String(value || '').trim().toLowerCase());
  return accepted.includes(pool);
}

function RoundOnePanel({ snapshot }) {
  const questionsPerRoundOneTeam = 10;
  const questionsPerRoundOnePool = questionsPerRoundOneTeam * 2;
  const roundOneQuestionsForTeam = (team) => snapshot.questions
    .filter((question) => question.roundKey === 'round1' && questionMatchesTeam(question, team))
    .slice(0, questionsPerRoundOneTeam);
  const interleaveQuestions = (teams) => {
    const questionsByTeam = teams.map((team) => ({ team, questions: roundOneQuestionsForTeam(team) }));
    return Array.from({ length: questionsPerRoundOneTeam }).flatMap((_, index) => questionsByTeam
      .map(({ team, questions }) => ({ team, question: questions[index], questionIndex: index + 1 }))
      .filter((item) => item.question));
  };
  const poolBoards = [
    { key: 'poule-1', label: 'Poule 1', teams: snapshot.teams.slice(0, 2) },
    { key: 'poule-2', label: 'Poule 2', teams: snapshot.teams.slice(2, 4) }
  ].map((pool) => ({ ...pool, sequence: interleaveQuestions(pool.teams) }));
  const currentQuestion = snapshot.state.currentQuestion;
  const currentQuestionTeam = currentQuestion
    ? snapshot.teams.find((team) => questionMatchesTeam(currentQuestion, team))
    : null;

  return (
    <section className="admin-panel wide round-control">
      <div className="section-title"><Flag size={18} /><h2>MANCHE 1 - L’Épreuve du Vrai</h2></div>
      <div className="button-row">
        <button onClick={() => api('/api/game/state', {
          method: 'POST',
          body: JSON.stringify({
            roundKey: 'round1',
            phase: 'round1',
            poolKey: '',
            currentQuestionId: null,
            revealAnswer: false,
            answerStatus: '',
            publicMode: 'question',
            publicQrVisible: false
          })
        })}
        >
          Manche
        </button>
        <button onClick={() => api('/api/game/state', {
          method: 'POST',
          body: JSON.stringify({
            roundKey: 'round1',
            phase: 'round1',
            poolKey: '',
            currentQuestionId: null,
            revealAnswer: false,
            answerStatus: '',
            publicMode: 'round1-results',
            publicQrVisible: false
          })
        })}
        >
          Scores plein ecran
        </button>
      </div>
      <div className="admin-pool-preview">
        <button
          className={snapshot.state.poolKey === 'poule-1' ? 'active-pool' : ''}
          onClick={() => {
            api('/api/game/state', {
              method: 'POST',
              body: JSON.stringify({
                roundKey: 'round1',
                phase: 'round1',
                poolKey: 'poule-1',
                currentQuestionId: null,
                revealAnswer: false,
                answerStatus: '',
                publicMode: 'question',
                publicQrVisible: false
              })
            });
          }}
        >
          <strong>Poule 1</strong>
          <span>{snapshot.teams[0]?.name || 'Equipe 1'} vs {snapshot.teams[1]?.name || 'Equipe 2'}</span>
        </button>
        <button
          className={snapshot.state.poolKey === 'poule-2' ? 'active-pool' : ''}
          onClick={() => {
            api('/api/game/state', {
              method: 'POST',
              body: JSON.stringify({
                roundKey: 'round1',
                phase: 'round1',
                poolKey: 'poule-2',
                currentQuestionId: null,
                revealAnswer: false,
                answerStatus: '',
                publicMode: 'question',
                publicQrVisible: false
              })
            });
          }}
        >
          <strong>Poule 2</strong>
          <span>{snapshot.teams[2]?.name || 'Equipe 3'} vs {snapshot.teams[3]?.name || 'Equipe 4'}</span>
        </button>
        <button
          className={snapshot.state.publicMode === 'blank-question' ? 'active-pool' : ''}
          onClick={() => api('/api/game/state', {
            method: 'POST',
            body: JSON.stringify({
              roundKey: 'round1',
              phase: 'round1',
              currentQuestionId: null,
              revealAnswer: false,
              answerStatus: '',
              publicMode: 'blank-question',
              publicQrVisible: false
            })
          })}
        >
          <strong>Ecran vierge</strong>
          <span>Masquer la question sans quitter la poule</span>
        </button>
      </div>
      <div className="round-one-dashboard-scores">
        {snapshot.teams.map((team) => (
          <article key={team.id}>
            <strong>{team.name}</strong>
            <div className="round-one-score-control">
              <button onClick={() => api(`/api/teams/${team.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ score: Math.max(0, team.score - 1) })
              })}
              >
                <Minus size={16} />
              </button>
              <b>{team.score}</b>
              <button onClick={() => api(`/api/teams/${team.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ score: team.score + 1 })
              })}
              >
                <Plus size={16} />
              </button>
            </div>
          </article>
        ))}
      </div>
      <div className="round-one-poule-board">
        {poolBoards.map((pool) => (
          <section className="question-table round-one-poule-list" key={pool.key}>
            <header>
              <div>
                <strong>{pool.label}</strong>
                <span>{pool.teams.map((team) => team?.name).filter(Boolean).join(' vs ')}</span>
              </div>
              <small>{pool.sequence.length}/{questionsPerRoundOnePool} questions</small>
            </header>
            {pool.sequence.map(({ team, question, questionIndex }, index) => (
              <article className={snapshot.state.currentQuestion?.id === question.id ? 'is-active-question' : ''} key={question.id}>
                <span>{index + 1}</span>
                <div>
                  <strong>{team.name} - Question {questionIndex}</strong>
                  <p>{cleanQuestionPrompt(question.prompt)}</p>
                  <small>Bonne reponse : {question.answer || 'non renseignee'}</small>
                </div>
                <button onClick={() => api('/api/game/state', {
                  method: 'POST',
                  body: JSON.stringify({
                    roundKey: 'round1',
                    phase: 'round1',
                    currentQuestionId: question.id,
                    revealAnswer: false,
                    publicMode: 'question',
                    poolKey: team.code || `team-${team.id}`,
                    answerStatus: ''
                  })
                })}
                >
                  Afficher
                </button>
              </article>
            ))}
            {!pool.sequence.length && (
              <p className="muted">
                Aucune question pour cette poule. Dans le CSV, utilise la colonne pool avec team-1, team-2, team-3 ou team-4.
              </p>
            )}
          </section>
        ))}
      </div>
      {currentQuestion && currentQuestion.roundKey === 'round1' && currentQuestionTeam && (
        <div className="answer-validation">
          <div>
            <strong>{currentQuestionTeam.name}</strong>
            <span>Validation de la question affichee</span>
          </div>
          <button onClick={async () => {
            await api(`/api/teams/${currentQuestionTeam.id}`, {
              method: 'PATCH',
              body: JSON.stringify({ score: currentQuestionTeam.score + 1 })
            });
            await api('/api/game/state', {
              method: 'POST',
              body: JSON.stringify({ revealAnswer: true, answerStatus: '' })
            });
          }}
          >
            <Check size={17} />
            Bonne reponse +1
          </button>
          <button className="danger" onClick={() => api('/api/game/state', {
            method: 'POST',
            body: JSON.stringify({ revealAnswer: true, answerStatus: '' })
          })}
          >
            <X size={17} />
            Mauvaise reponse
          </button>
        </div>
      )}
    </section>
  );
}

function StroopPanel({ snapshot }) {
  const teamIds = (snapshot.state.stroopTeamIds || []).map(String);
  const selectedTeams = teamIds
    .map((id) => snapshot.teams.find((team) => team.id === Number(id)))
    .filter(Boolean);
  const activeTeamId = String(snapshot.state.stroopActiveTeamId || teamIds[0] || '');
  const activeTeam = selectedTeams.find((team) => String(team.id) === activeTeamId);
  const activeSlot = Math.max(0, selectedTeams.findIndex((team) => String(team.id) === activeTeamId));
  const progress = snapshot.state.stroopProgress || {};
  const activeProgress = Math.min(Math.max(Number(progress[activeTeamId] || 0), 0), STROOP_PER_TEAM - 1);
  const index = activeSlot * STROOP_PER_TEAM + activeProgress;
  const streaks = snapshot.state.stroopStreaks || {};
  const bests = snapshot.state.stroopBests || {};

  async function updateStroop(patch) {
    await api('/api/game/state', {
      method: 'POST',
      body: JSON.stringify(patch)
    });
  }

  async function toggleTeam(teamId) {
    const id = String(teamId);
    const nextIds = teamIds.includes(id)
      ? teamIds.filter((item) => item !== id)
      : teamIds.length >= 2
        ? [...teamIds.slice(1), id]
        : [...teamIds, id];
    await updateStroop({
      stroopTeamIds: nextIds,
      stroopActiveTeamId: Number(nextIds[0]) || null,
      answerStatus: ''
    });
  }

  async function showIntro(reset = false) {
    const nextIds = teamIds.length === 2 ? teamIds : snapshot.teams.slice(0, 2).map((team) => String(team.id));
    await updateStroop({
      roundKey: 'stroop',
      phase: 'stroop',
      poolKey: '',
      publicMode: 'stroop-intro',
      currentQuestionId: null,
      revealAnswer: false,
      answerStatus: '',
      publicQrVisible: false,
      stroopTeamIds: nextIds,
      stroopIndex: 0,
      stroopActiveTeamId: Number(nextIds[0]) || null,
      ...(reset ? { stroopProgress: {}, stroopStreaks: {}, stroopBests: {} } : {})
    });
  }

  async function launchTeam(teamId) {
    const nextIds = teamIds.length === 2 ? teamIds : snapshot.teams.slice(0, 2).map((team) => String(team.id));
    await updateStroop({
      roundKey: 'stroop',
      phase: 'stroop',
      publicMode: 'stroop-play',
      currentQuestionId: null,
      revealAnswer: false,
      answerStatus: '',
      publicQrVisible: false,
      stroopTeamIds: nextIds,
      stroopActiveTeamId: Number(teamId || nextIds[0]) || null
    });
  }

  async function stepVisual(delta) {
    if (!activeTeam) return;
    const key = String(activeTeam.id);
    const nextProgress = Math.min(Math.max(activeProgress + delta, 0), STROOP_PER_TEAM - 1);
    await updateStroop({
      roundKey: 'stroop',
      publicMode: 'stroop-play',
      answerStatus: '',
      stroopProgress: { ...progress, [key]: nextProgress }
    });
  }

  async function markAnswer(correct) {
    if (!activeTeam) return;
    const key = String(activeTeam.id);
    const current = Number(streaks[key] || 0);
    const nextStreak = current + 1;
    const payload = {
      answerStatus: correct ? 'correct' : 'wrong',
      publicMode: 'stroop-play'
    };

    if (correct) {
      payload.stroopStreaks = { ...streaks, [key]: nextStreak };
      payload.stroopBests = {
        ...bests,
        [key]: Math.max(Number(bests[key] || 0), nextStreak)
      };
      payload.stroopProgress = { ...progress, [key]: Math.min(activeProgress + 1, STROOP_PER_TEAM - 1) };
    }

    await updateStroop(payload);
  }

  return (
    <section className="admin-panel wide round-control stroop-admin-panel">
      <div className="section-title"><Flag size={18} /><h2>MINI-JEU - L’Épreuve des Illusions</h2></div>
      <div className="round-two-team-picker">
        <strong>Selection des 2 maisons</strong>
        <p>Choisis les deux maisons qui jouent cette epreuve Stroop.</p>
        <div>
          {snapshot.teams.map((team) => (
            <button
              className={teamIds.includes(String(team.id)) ? 'selected' : ''}
              key={team.id}
              onClick={() => toggleTeam(team.id)}
            >
              {team.name}
            </button>
          ))}
        </div>
        <span>{selectedTeams.length}/2 selectionnees</span>
      </div>

      <div className="button-row">
        <button onClick={() => showIntro(false)}>Afficher annonce</button>
        <button onClick={() => updateStroop({ roundKey: 'stroop', phase: 'stroop', publicMode: 'stroop-results', currentQuestionId: null, answerStatus: '' })}>Afficher scores</button>
        <button onClick={() => showIntro(true)}>Recommencer a zero</button>
        <button disabled={!activeTeam} onClick={() => stepVisual(-1)}>Visuel precedent</button>
        <button disabled={!activeTeam} onClick={() => stepVisual(1)}>Visuel suivant</button>
      </div>

      <div className="stroop-admin-grid">
        <div className="stroop-current-card">
          <span>Visuel</span>
          <strong>{activeProgress + 1}/{STROOP_PER_TEAM}</strong>
          <small>Chaque maison a 40 propositions. Les joueurs doivent dire la couleur affichee, pas le mot ecrit.</small>
        </div>
        <div className="stroop-current-card">
          <span>Maison en passage</span>
          <strong>{activeTeam?.name || 'Selectionne une maison'}</strong>
          <div className="button-row compact-buttons">
            {selectedTeams.map((team) => (
              <button
                className={String(team.id) === activeTeamId ? 'selected' : ''}
                key={team.id}
                onClick={() => launchTeam(team.id)}
              >
                Lancer {team.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="stroop-score-list">
        {selectedTeams.map((team) => (
          <article className={String(team.id) === activeTeamId ? 'active' : ''} key={team.id}>
            <strong>{team.name}</strong>
            <span>Points : {streaks[team.id] || 0}</span>
          </article>
        ))}
      </div>

      <div className="answer-validation stroop-validation">
        <button disabled={!activeTeam} onClick={() => markAnswer(true)}><Check size={18} /> Bonne reponse</button>
        <button disabled={!activeTeam} className="danger" onClick={() => markAnswer(false)}><X size={18} /> Erreur</button>
      </div>
    </section>
  );
}

function RoundTwoPanel({ snapshot }) {
  const roundTwoTeamIds = snapshot.state.roundTwoTeamIds || [];
  const roundTwoThemes = snapshot.questions
    .filter((question) => question.roundKey === 'round2')
    .slice(0, 6);
  const activeTeams = roundTwoTeamIds.length
    ? roundTwoTeamIds.map((id) => snapshot.teams.find((team) => team.id === Number(id))).filter(Boolean)
    : snapshot.teams.slice(0, 3);

  async function toggleRoundTwoTeam(teamId) {
    const nextIds = (() => {
      const current = roundTwoTeamIds.map(String);
      const id = String(teamId);
      if (current.includes(id)) {
        return current.filter((item) => item !== id);
      }
      if (current.length >= 3) {
        return [...current.slice(1), id];
      }
      return [...current, id];
    })();

    await api('/api/game/state', {
      method: 'POST',
      body: JSON.stringify({ roundTwoTeamIds: nextIds })
    });
  }

  async function addMalus(team) {
    const nextMalus = team.malus + 1;
    await api(`/api/teams/${team.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        malus: nextMalus,
        eliminated: nextMalus >= 2
      })
    });
  }

  async function removeMalus(team) {
    const nextMalus = Math.max(0, team.malus - 1);
    await api(`/api/teams/${team.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        malus: nextMalus,
        eliminated: false
      })
    });
  }

  return (
    <section className="admin-panel wide round-control">
      <div className="section-title"><Flag size={18} /><h2>MANCHE 2 - Le Champ des Connaissances</h2></div>
      <div className="round-two-team-picker">
        <strong>Selection des 3 equipes</strong>
        <p>Clique sur une equipe pour la selectionner ou la deselectionner.</p>
        <div>
          {snapshot.teams.map((team) => (
            <button
              className={roundTwoTeamIds.includes(String(team.id)) ? 'selected' : ''}
              key={team.id}
              onClick={() => toggleRoundTwoTeam(team.id)}
            >
              {team.name}
            </button>
          ))}
        </div>
        <span>{activeTeams.length}/3 selectionnees</span>
      </div>
      <div className="selected-round-two-teams">
        {activeTeams.map((team) => (
          <article className={team.eliminated ? 'is-eliminated' : ''} key={team.id}>
            <strong>{team.name}</strong>
            <span>{team.malus}/2 malus</span>
          </article>
        ))}
        {!activeTeams.length && <p className="muted">Aucune equipe selectionnee.</p>}
      </div>
      <div className="button-row">
        <button onClick={() => api('/api/game/state', {
          method: 'POST',
          body: JSON.stringify({
            roundKey: 'round2',
            phase: 'round2',
            poolKey: '',
            currentQuestionId: null,
            revealAnswer: false,
            answerStatus: '',
            publicMode: 'question',
            publicQrVisible: false
          })
        })}
        >
          Lancer la manche 2
        </button>
        <button onClick={() => api('/api/game/state', {
          method: 'POST',
          body: JSON.stringify({
            roundKey: 'round2',
            phase: 'round2',
            currentQuestionId: null,
            revealAnswer: false,
            answerStatus: '',
            publicMode: 'round2-results',
            publicQrVisible: false
          })
        })}
        >
          Scores plein ecran
        </button>
        <button onClick={() => api('/api/game/state', {
          method: 'POST',
          body: JSON.stringify({
            roundKey: 'round2',
            phase: 'round2',
            currentQuestionId: null,
            revealAnswer: false,
            answerStatus: '',
            publicMode: 'blank-question',
            publicQrVisible: false
          })
        })}
        >
          Ecran vierge
        </button>
      </div>

      <div className="round-two-admin-grid">
        <div className="theme-launch-list">
          <h3>6 themes</h3>
          {roundTwoThemes.map((theme, index) => (
            <article className={snapshot.state.currentQuestion?.id === theme.id ? 'is-active-theme' : ''} key={theme.id}>
              <span>{index + 1}</span>
              <strong>{themeLabel(theme)}</strong>
              <button onClick={() => api('/api/game/state', {
                method: 'POST',
                body: JSON.stringify({
                  roundKey: 'round2',
                  phase: 'round2',
                  currentQuestionId: theme.id,
                  revealAnswer: false,
                  answerStatus: '',
                  publicMode: 'question',
                  publicQrVisible: false
                })
              })}
              >
                Lancer
              </button>
            </article>
          ))}
          {!roundTwoThemes.length && <p className="muted">Ajoute 6 lignes round2 dans le CSV pour remplir les themes.</p>}
        </div>

        <div className="malus-control-list">
          <h3>Malus</h3>
          {activeTeams.map((team) => (
            <article className={team.eliminated ? 'is-eliminated' : ''} key={team.id}>
              <div>
                <strong>{team.name}</strong>
                <span>{team.malus}/2 malus</span>
              </div>
              <div className="malus-action-row">
                <button onClick={() => removeMalus(team)}>- malus</button>
                <button className="danger" onClick={() => addMalus(team)}>+ malus</button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function DrawingPanel({ snapshot }) {
  const drawingTeamIds = (snapshot.state.drawingTeamIds || []).map(String);
  const [draftTeamIds, setDraftTeamIds] = useState(drawingTeamIds);
  const draftTeamIdsRef = useRef(drawingTeamIds);
  const [teamsTouched, setTeamsTouched] = useState(false);
  const selectedTeams = draftTeamIds
    .map((id) => snapshot.teams.find((team) => team.id === Number(id)))
    .filter(Boolean);
  const voteRows = (snapshot.state.voteOptions?.length
    ? snapshot.state.voteOptions
    : selectedTeams.map((team) => ({ id: String(team.id), label: team.name }))
  ).map((option) => ({
    ...option,
    count: snapshot.votes.find((vote) => vote.option_id === option.id)?.count || 0
  }));
  const voteTotal = voteRows.reduce((sum, row) => sum + row.count, 0);
  const [prompt, setPrompt] = useState(cleanDrawingPrompt(snapshot.state.drawingPrompt));
  const promptRef = useRef(cleanDrawingPrompt(snapshot.state.drawingPrompt));
  const [promptTouched, setPromptTouched] = useState(false);

  useEffect(() => {
    if (!promptTouched) {
      const nextPrompt = cleanDrawingPrompt(snapshot.state.drawingPrompt);
      setPrompt(nextPrompt);
      promptRef.current = nextPrompt;
    }
  }, [promptTouched, snapshot.state.drawingPrompt]);

  useEffect(() => {
    if (!teamsTouched) {
      setDraftTeamIds(drawingTeamIds);
      draftTeamIdsRef.current = drawingTeamIds;
    }
  }, [drawingTeamIds, teamsTouched]);

  function teamsFromIds(ids) {
    return ids
      .map((id) => snapshot.teams.find((team) => team.id === Number(id)))
      .filter(Boolean);
  }

  function playableTeamIds() {
    const ids = draftTeamIdsRef.current;
    return ids.length === 2
      ? ids
      : snapshot.teams.slice(0, 2).map((team) => String(team.id));
  }

  async function toggleTeam(teamId) {
    const id = String(teamId);
    const nextIds = draftTeamIds.includes(id)
      ? draftTeamIds.filter((item) => item !== id)
      : draftTeamIds.length >= 2
        ? [...draftTeamIds.slice(1), id]
        : [...draftTeamIds, id];

    setDraftTeamIds(nextIds);
    draftTeamIdsRef.current = nextIds;
    setTeamsTouched(true);
    await api('/api/game/state', {
      method: 'POST',
      body: JSON.stringify({ drawingTeamIds: nextIds })
    });
  }

  async function launchIntro() {
    const nextIds = playableTeamIds();
    const nextPrompt = cleanDrawingPrompt(promptRef.current || prompt);
    setDraftTeamIds(nextIds);
    draftTeamIdsRef.current = nextIds;
    setTeamsTouched(true);
    await api('/api/drawing/launch', {
      method: 'POST',
      body: JSON.stringify({
        mode: 'intro',
        teamIds: nextIds,
        prompt: nextPrompt
      })
    });
  }

  async function launchDrawing() {
    const nextIds = playableTeamIds();
    const nextPrompt = cleanDrawingPrompt(promptRef.current || prompt);
    setDraftTeamIds(nextIds);
    draftTeamIdsRef.current = nextIds;
    setTeamsTouched(true);
    await api('/api/drawing/launch', {
      method: 'POST',
      body: JSON.stringify({
        mode: 'task',
        teamIds: nextIds,
        prompt: nextPrompt
      })
    });
  }

  async function showVoteQr() {
    const voteTeamIds = playableTeamIds();
    const voteTeams = teamsFromIds(voteTeamIds);
    setDraftTeamIds(voteTeamIds);
    draftTeamIdsRef.current = voteTeamIds;
    setTeamsTouched(true);
    await api('/api/game/state', {
      method: 'POST',
      body: JSON.stringify({ drawingTeamIds: voteTeamIds })
    });
    await api('/api/vote/open', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Vote du public',
        options: voteTeams.map((team) => ({ id: String(team.id), label: team.name })),
        publicQrVisible: true
      })
    });
    await api('/api/game/state', {
      method: 'POST',
      body: JSON.stringify({
        roundKey: 'drawing',
        phase: 'drawing',
        currentQuestionId: null,
        publicMode: 'vote-qr',
        publicQrVisible: true
      })
    });
  }

  async function showVoteResults() {
    await api('/api/game/state', {
      method: 'POST',
      body: JSON.stringify({
        roundKey: 'drawing',
        phase: 'drawing',
        currentQuestionId: null,
        publicMode: 'vote-results',
        publicQrVisible: false
      })
    });
  }

  return (
    <section className="admin-panel wide round-control">
      <div className="section-title"><Vote size={18} /><h2>MINI-JEU - Le Duel des Illustrateurs</h2></div>
      <div className="round-two-team-picker">
        <strong>Selection des 2 equipes</strong>
        <p>Clique pour selectionner ou deselectionner les equipes qui dessinent.</p>
        <div>
          {snapshot.teams.map((team) => (
            <button
              className={draftTeamIds.includes(String(team.id)) ? 'selected' : ''}
              key={team.id}
              onClick={() => toggleTeam(team.id)}
            >
              {team.name}
            </button>
          ))}
        </div>
        <span>{selectedTeams.length}/2 selectionnees</span>
      </div>
      <label className="drawing-prompt-field">
        Consigne a afficher
        <input value={prompt} onChange={(event) => {
          const nextPrompt = event.target.value;
          setPromptTouched(true);
          promptRef.current = nextPrompt;
          setPrompt(nextPrompt);
        }} />
      </label>
      <div className="drawing-live-votes">
        <div>
          <strong>Votes en direct</strong>
          <span>{voteTotal} vote{voteTotal > 1 ? 's' : ''}</span>
        </div>
        {voteRows.length ? voteRows.map((row) => {
          const percent = voteTotal ? Math.round((row.count / voteTotal) * 100) : 0;
          return (
            <article key={row.id}>
              <span>{row.label}</span>
              <div><i style={{ width: `${percent}%` }} /></div>
              <b>{percent}%</b>
              <em>{row.count}</em>
            </article>
          );
        }) : (
          <p className="muted">Selectionne 2 equipes puis affiche le QR pour ouvrir le vote.</p>
        )}
      </div>
      <div className="button-row">
        <button onClick={launchIntro}>Le Duel des Illustrateurs</button>
        <button onClick={launchDrawing}>Afficher consigne + chrono 1 min</button>
        <button onClick={showVoteQr}>Afficher QR vote</button>
        <button disabled={!snapshot.state.voteOptions?.length} onClick={showVoteResults}>Afficher animation pourcentages</button>
      </div>
    </section>
  );
}

function RoundThreePanel({ snapshot }) {
  const roundThreeTeamIds = (snapshot.state.roundThreeTeamIds || []).map(String);
  const selectedTeams = getRoundThreeTeams(snapshot.teams, roundThreeTeamIds);
  const roundThreeQuestions = snapshot.questions.filter((question) => question.roundKey === 'round3');
  const buzzWinner = snapshot.teams.find((team) => team.id === snapshot.state.buzzWinnerTeamId);
  const buzzWinnerInSelection = selectedTeams.some((team) => team.id === buzzWinner?.id);
  const otherTeam = selectedTeams.find((team) => team.id !== Number(buzzWinner?.id));

  async function toggleTeam(teamId) {
    const id = String(teamId);
    const nextIds = roundThreeTeamIds.includes(id)
      ? roundThreeTeamIds.filter((item) => item !== id)
      : roundThreeTeamIds.length >= 2
        ? [...roundThreeTeamIds.slice(1), id]
        : [...roundThreeTeamIds, id];

    await api('/api/game/state', {
      method: 'POST',
      body: JSON.stringify({ roundThreeTeamIds: nextIds })
    });
  }

  async function launchQuestion(question) {
    const teamIds = roundThreeTeamIds.length === 2
      ? roundThreeTeamIds
      : snapshot.teams.slice(0, 2).map((team) => String(team.id));
    await api('/api/round3/question', {
      method: 'POST',
      body: JSON.stringify({ questionId: question.id, teamIds })
    });
  }

  async function validateAnswer(correct) {
    await api('/api/round3/answer', {
      method: 'POST',
      body: JSON.stringify({ correct })
    });
  }

  async function adjustScore(team, delta) {
    await api(`/api/teams/${team.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ score: Math.max(0, team.score + delta) })
    });
  }

  function playableTeamIds() {
    return roundThreeTeamIds.length === 2
      ? roundThreeTeamIds
      : snapshot.teams.slice(0, 2).map((team) => String(team.id));
  }

  async function showRoundThreeIntro() {
    await api('/api/game/state', {
      method: 'POST',
      body: JSON.stringify({
        roundKey: 'round3',
        phase: 'round3',
        roundThreeTeamIds: playableTeamIds(),
        currentQuestionId: null,
        revealAnswer: false,
        answerStatus: '',
        publicMode: 'round3-intro',
        publicQrVisible: false
      })
    });
  }

  async function showRoundThreeWaiting() {
    await api('/api/buzzer/reset', { method: 'POST' });
    await api('/api/game/state', {
      method: 'POST',
      body: JSON.stringify({
        roundKey: 'round3',
        phase: 'round3',
        roundThreeTeamIds: playableTeamIds(),
        currentQuestionId: null,
        revealAnswer: false,
        answerStatus: '',
        publicMode: 'blank-question',
        publicQrVisible: false
      })
    });
  }

  return (
    <section className="admin-panel wide round-control round-three-panel">
      <div className="section-title"><Radio size={18} /><h2>MANCHE 3 - Les Joutes du Savoir</h2></div>

      <div className="round-two-team-picker">
        <strong>Selection des 2 equipes</strong>
        <p>Ces equipes auront les QR buzzer et serviront pour l attribution automatique des points.</p>
        <div>
          {snapshot.teams.map((team) => (
            <button
              className={roundThreeTeamIds.includes(String(team.id)) ? 'selected' : ''}
              key={team.id}
              onClick={() => toggleTeam(team.id)}
            >
              {team.name}
            </button>
          ))}
        </div>
        <span>{selectedTeams.length}/2 selectionnees</span>
      </div>

      <div className="button-row">
        <button onClick={showRoundThreeIntro}>Lancer manche 3</button>
        <button onClick={showRoundThreeWaiting}>Question en attente</button>
      </div>

      <RoundThreeScoreStrip teams={snapshot.teams} roundThreeTeamIds={roundThreeTeamIds} editable onAdjust={adjustScore} />

      <div className="round-three-grid">
        <div className="theme-launch-list round-three-question-list">
          <h3>Questions des Joutes</h3>
          {roundThreeQuestions.map((question, index) => (
            <article className={snapshot.state.currentQuestion?.id === question.id ? 'is-active-theme' : ''} key={question.id}>
              <span>{index + 1}</span>
              <strong>{cleanQuestionPrompt(question.prompt)}</strong>
              <button onClick={() => launchQuestion(question)}>Lancer + debloquer</button>
            </article>
          ))}
          {!roundThreeQuestions.length && <p className="muted">Ajoute des lignes round3 dans le CSV pour remplir les questions des Joutes.</p>}
        </div>

        <div className="buzz-admin-box">
          <div className="buzz-admin-header">
            <h3>Buzzers & validation</h3>
            <span>{snapshot.state.buzzLocked ? 'Verrouille' : 'Pret'}</span>
          </div>
          <div className="qr-grid">
            {selectedTeams.map((team, index) => (
              <div className="qr-card" key={team.id}>
                <QRCodeSVG value={`${window.location.origin}/buzzer-slot/${index + 1}`} size={100} />
                <span>Buzzer {index + 1}</span>
                <strong>{team.name}</strong>
              </div>
            ))}
          </div>
          <button onClick={() => api('/api/buzzer/reset', { method: 'POST' })}>Debloquer buzzers</button>
          {buzzWinner && buzzWinnerInSelection ? (
            <div className="buzz-validation-box">
              <strong>Premier buzz : {buzzWinner.name}</strong>
              <p>Juste : {buzzWinner.name} marque 1 point. Faux : {otherTeam?.name || 'l autre equipe'} marque 1 point.</p>
              <div className="button-row">
                <button onClick={() => validateAnswer(true)}><Check size={17} /> Reponse juste</button>
                <button className="danger" onClick={() => validateAnswer(false)}><X size={17} /> Reponse fausse</button>
              </div>
            </div>
          ) : buzzWinner ? (
            <div className="buzz-validation-box">
              <strong>Buzz hors selection : {buzzWinner.name}</strong>
              <p>Relance la question ou utilise les QR Buzzer 1 et Buzzer 2 affiches dans cette manche.</p>
            </div>
          ) : (
            <p className="muted">Aucun buzz pour le moment. Lance une question pour debloquer les buzzers.</p>
          )}
        </div>
      </div>
    </section>
  );
}

function DragonPanel({ snapshot }) {
  const savedPlayers = getDragonPlayers(snapshot.state);
  const [draftNames, setDraftNames] = useState(savedPlayers.map((player) => player.name));
  useEffect(() => {
    setDraftNames(savedPlayers.map((player) => player.name));
  }, [JSON.stringify(snapshot.state.dragonPlayers || [])]);
  const players = savedPlayers.map((player, index) => ({
    ...player,
    name: draftNames[index]?.trim() || `Participant ${index + 1}`
  }));
  const activePlayer = players.find((player) => player.id === Number(snapshot.state.dragonActivePlayerId));
  const dragonQuestions = snapshot.questions.filter((question) => question.roundKey === 'dragon');
  const activeIndex = Math.max(0, Number(snapshot.state.dragonIndex || 0));
  const activeQuestion = snapshot.state.currentQuestion?.roundKey === 'dragon'
    ? snapshot.state.currentQuestion
    : dragonQuestions[activeIndex];
  const scores = snapshot.state.dragonScores || {};
  const answers = snapshot.state.dragonAnswers || {};
  const revealCount = Math.max(0, Number(snapshot.state.dragonRevealCount || 0));
  const answeredQuestions = dragonQuestions.filter((question) => players.some((player) => answers[player.id]?.[question.id]));
  const revealQuestions = answeredQuestions.length ? answeredQuestions : dragonQuestions;
  const revealTotal = revealQuestions.length;
  const currentRevealIndex = Math.max(0, revealQuestions.findIndex((question) => question.id === Number(snapshot.state.dragonRevealQuestionId)));
  const normalizedDragonNames = [0, 1, 2].map((index) => draftNames[index]?.trim() || `Participant ${index + 1}`);

  function updateDragonPlayer(index, value) {
    const nextPlayers = [...draftNames];
    nextPlayers[index] = value;
    setDraftNames(nextPlayers);
  }

  async function saveDragonPlayers() {
    await api('/api/game/state', {
      method: 'POST',
      body: JSON.stringify({ dragonPlayers: normalizedDragonNames })
    });
  }

  async function showIntro(reset = false) {
    await api('/api/game/state', {
      method: 'POST',
      body: JSON.stringify({
        roundKey: 'dragon',
        phase: 'dragon',
        publicMode: 'dragon-intro',
        currentQuestionId: null,
        revealAnswer: false,
        answerStatus: '',
        dragonPlayers: normalizedDragonNames,
        dragonPlayerIds: ['1', '2', '3'],
        dragonActivePlayerId: 1,
        dragonIndex: 0,
        dragonRevealCount: 0,
        dragonRevealQuestionId: null,
        ...(reset ? { dragonScores: {}, dragonAnswers: {} } : {})
      })
    });
    await api('/api/timer/stop', { method: 'POST' });
  }

  async function startPlayer(playerId) {
    if (!dragonQuestions.length) return;
    const player = players.find((item) => item.id === Number(playerId));
    await api('/api/game/state', {
      method: 'POST',
      body: JSON.stringify({
        roundKey: 'dragon',
        phase: 'dragon',
        publicMode: 'dragon-question',
        currentQuestionId: dragonQuestions[0].id,
        revealAnswer: false,
        answerStatus: '',
        dragonPlayers: normalizedDragonNames,
        dragonPlayerIds: ['1', '2', '3'],
        dragonActivePlayerId: Number(playerId),
        dragonIndex: 0,
        dragonRevealCount: 0,
        dragonRevealQuestionId: null
      })
    });
    await api('/api/timer/start', {
      method: 'POST',
      body: JSON.stringify({ seconds: player?.duration || 60, label: 'Dragon' })
    });
  }

  async function markDragonAnswer(status) {
    if (!activePlayer || !activeQuestion) return;
    const playerKey = String(activePlayer.id);
    const previousPlayerAnswers = answers[playerKey] || {};
    const nextAnswers = {
      ...answers,
      [playerKey]: {
        ...previousPlayerAnswers,
        [activeQuestion.id]: status
      }
    };
    const nextScores = {
      ...scores,
      [playerKey]: Math.max(0, Number(scores[playerKey] || 0) + (status === 'correct' ? 1 : 0))
    };
    const nextIndex = activeIndex + 1;
    const nextQuestion = dragonQuestions[nextIndex] || null;
    await api('/api/game/state', {
      method: 'POST',
      body: JSON.stringify({
        currentQuestionId: nextQuestion?.id || null,
        publicMode: nextQuestion ? 'dragon-question' : 'dragon-player-done',
        dragonIndex: nextIndex,
        dragonScores: nextScores,
        dragonAnswers: nextAnswers,
        answerStatus: status
      })
    });
  }

  async function showResults() {
    await api('/api/timer/stop', { method: 'POST' });
    await api('/api/game/state', {
      method: 'POST',
      body: JSON.stringify({
        roundKey: 'dragon',
        phase: 'dragon',
        currentQuestionId: null,
        publicMode: 'dragon-results',
        revealAnswer: false,
        dragonPlayers: normalizedDragonNames,
        dragonRevealCount: 0,
        dragonRevealQuestionId: null
      })
    });
  }

  async function revealNextDragonQuestion() {
    const nextIndex = snapshot.state.dragonRevealQuestionId
      ? Math.min(currentRevealIndex + 1, Math.max(0, revealTotal - 1))
      : 0;
    const nextQuestion = revealQuestions[nextIndex];
    await api('/api/game/state', {
      method: 'POST',
      body: JSON.stringify({
        roundKey: 'dragon',
        phase: 'dragon',
        currentQuestionId: null,
        publicMode: 'dragon-results',
        revealAnswer: false,
        dragonPlayers: normalizedDragonNames,
        dragonRevealCount: nextIndex + 1,
        dragonRevealQuestionId: nextQuestion?.id || null
      })
    });
  }

  async function revealPreviousDragonQuestion() {
    const previousIndex = snapshot.state.dragonRevealQuestionId
      ? Math.max(0, currentRevealIndex - 1)
      : 0;
    const previousQuestion = revealQuestions[previousIndex];
    await api('/api/game/state', {
      method: 'POST',
      body: JSON.stringify({
        roundKey: 'dragon',
        phase: 'dragon',
        currentQuestionId: null,
        publicMode: 'dragon-results',
        revealAnswer: false,
        dragonPlayers: normalizedDragonNames,
        dragonRevealCount: previousIndex + 1,
        dragonRevealQuestionId: previousQuestion?.id || null
      })
    });
  }

  return (
    <section className="admin-panel wide round-control dragon-panel">
      <div className="section-title"><Shield size={18} /><h2>MANCHE 4 - L’Épreuve du Dragon</h2></div>
      <div className="round-two-team-picker dragon-name-editor">
        <strong>Noms des 3 participants</strong>
        <p>Rentre les noms ici. Ils remplaceront les maisons sur tous les écrans du Dragon.</p>
        <div>
          {players.map((player, index) => (
            <label key={player.id}>
              <span>Série {index + 1} - {player.duration}s</span>
              <input
                value={draftNames[index] || ''}
                onChange={(event) => updateDragonPlayer(index, event.target.value)}
                placeholder={`Participant ${index + 1}`}
              />
            </label>
          ))}
        </div>
        <button onClick={saveDragonPlayers}>Enregistrer les participants</button>
      </div>

      <div className="button-row">
        <button onClick={() => showIntro(false)}>Annonce manche 4</button>
        <button onClick={() => showIntro(true)}>Remettre le Dragon a zero</button>
        <button onClick={showResults}>Reveler les scores</button>
        <button disabled={!revealTotal} onClick={revealPreviousDragonQuestion}>Question precedente</button>
        <button disabled={!revealTotal} onClick={revealNextDragonQuestion}>Question suivante ({Math.min(revealCount || 0, revealTotal)}/{revealTotal})</button>
      </div>

      <div className="dragon-player-launches">
        {players.map((player, index) => (
          <article className={activePlayer?.id === player.id ? 'is-active-theme' : ''} key={player.id}>
            <strong>Série {index + 1} - {player.name}</strong>
            <span>{scores[player.id] || 0} bonne{Number(scores[player.id] || 0) > 1 ? 's' : ''}</span>
            <button onClick={() => startPlayer(player.id)}>Lancer {player.duration}s</button>
          </article>
        ))}
      </div>

      <div className="dragon-control-grid">
        <div className="dragon-current-admin">
          <span>{activePlayer ? activePlayer.name : 'Aucun joueur en cours'}</span>
          <strong>{activeQuestion ? `${activeIndex + 1}. ${cleanQuestionPrompt(activeQuestion.prompt)}` : 'Lance une série pour afficher la première question.'}</strong>
          {activeQuestion?.answer && <small>Réponse attendue : {activeQuestion.answer}</small>}
        </div>
        <div className="answer-validation dragon-validation">
          <button disabled={!activeQuestion || !activePlayer} onClick={() => markDragonAnswer('correct')}><Check size={17} /> Juste</button>
          <button disabled={!activeQuestion || !activePlayer} className="danger" onClick={() => markDragonAnswer('wrong')}><X size={17} /> Faux</button>
          <button disabled={!activeQuestion || !activePlayer} onClick={() => markDragonAnswer('skipped')}><TimerReset size={17} /> Passer</button>
        </div>
      </div>

      <div className="dragon-admin-table">
        <header>
          <span>Question</span>
          <strong>Réponse</strong>
          {players.map((player) => <strong key={player.id}>{player.name}</strong>)}
        </header>
        {dragonQuestions.slice(0, 20).map((question, index) => (
          <article key={question.id}>
            <span>{index + 1}. {cleanQuestionPrompt(question.prompt)}</span>
            <strong>{question.answer || '-'}</strong>
            {players.map((player) => {
              const status = answers[player.id]?.[question.id] || '';
              return <em className={`dragon-answer-status status-${status || 'empty'}`} key={player.id}>{status === 'correct' ? 'Juste' : status === 'wrong' ? 'Faux' : status === 'skipped' ? 'Passé' : '-'}</em>;
            })}
          </article>
        ))}
        {!dragonQuestions.length && <p className="muted">Ajoute des lignes dragon dans le CSV pour remplir la manche 4.</p>}
      </div>
    </section>
  );
}

function Admin({ snapshot, refresh, error }) {
  const [csvStatus, setCsvStatus] = useState('');
  const [dashboardRoundKey, setDashboardRoundKey] = useState('welcome');
  const logged = Boolean(localStorage.getItem('adminToken'));

  if (!logged) return <Login refresh={refresh} />;

  async function importCsv(file) {
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (result) => {
        await api('/api/questions/import', { method: 'POST', body: JSON.stringify({ questions: result.data }) });
        setCsvStatus(`${result.data.length} lignes importees`);
      }
    });
  }

  async function patchTeam(team, patch) {
    await api(`/api/teams/${team.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
  }

  const isRoundOne = dashboardRoundKey === 'round1';
  const isWelcome = dashboardRoundKey === 'welcome';
  const isPreRoundOne = dashboardRoundKey === 'premanche1';
  const isPreRoundTwo = dashboardRoundKey === 'premanche2';
  const isDrawing = dashboardRoundKey === 'drawing';
  const isBuzzRound = dashboardRoundKey === 'round3';
  const isStroop = dashboardRoundKey === 'stroop';
  const isChain = dashboardRoundKey === 'round2';
  const isDragon = dashboardRoundKey === 'dragon';
  const showTimer = !isWelcome && !isPreRoundOne && !isPreRoundTwo && !isRoundOne && !isStroop && !isChain && !isDragon;
  const showQuestionActive = !isWelcome && !isPreRoundOne && !isPreRoundTwo && !isStroop && !isDrawing && !isChain && !isDragon;
  const showGenericQuestions = !isWelcome && !isPreRoundOne && !isPreRoundTwo && !isRoundOne && !isChain && !isDrawing && !isBuzzRound && !isDragon;
  const currentRoundQuestions = snapshot.questions.filter((question) => question.roundKey === dashboardRoundKey);

  return (
    <main className="admin-layout">
      <aside className="admin-sidebar">
        <div className="admin-brand"><GameLogo compact /> Quiz Live</div>
        {rounds.map((round) => (
          <button
            key={round.key}
            className={dashboardRoundKey === round.key ? 'active' : ''}
            onClick={() => setDashboardRoundKey(round.key)}
          >
            {round.label}
          </button>
        ))}
        <button className="danger" onClick={() => api('/api/reset', { method: 'POST' })}><RotateCcw size={16} /> Reset jeu</button>
      </aside>

      <section className="admin-main">
        {error && <p className="error">{error}</p>}
        <div className="admin-toolbar">
          <h1>{isRoundOne ? 'MANCHE 1 - L’Épreuve du Vrai' : 'Regie live'}</h1>
          <a href="/screen" target="_blank">Ecran public</a>
        </div>

        <div className="admin-panels">
          {isWelcome && (
            <section className="admin-panel wide round-control welcome-admin-panel">
              <div className="section-title"><Flag size={18} /><h2>Accueil</h2></div>
              <p className="muted">Envoie l'affiche d'accueil sur l'ecran public avant de commencer le jeu.</p>
              <div className="button-row">
                <button
                  onClick={() => api('/api/game/state', {
                    method: 'POST',
                    body: JSON.stringify({
                      roundKey: 'welcome',
                      publicMode: 'welcome-poster',
                      currentQuestionId: null,
                      revealAnswer: false,
                      answerStatus: '',
                      poolKey: '',
                      publicQrVisible: false
                    })
                  })}
                >
                  <Eye size={17} />
                  Afficher l'accueil
                </button>
                <button
                  onClick={() => api('/api/game/state', {
                    method: 'POST',
                    body: JSON.stringify({
                      roundKey: 'welcome',
                      publicMode: 'welcome',
                      currentQuestionId: null,
                      revealAnswer: false,
                      answerStatus: '',
                      publicQrVisible: false
                    })
                  })}
                >
                  <EyeOff size={17} />
                  Vider l'ecran
                </button>
              </div>
            </section>
          )}

          {showQuestionActive && <section className="admin-panel wide">
            <div className="section-title"><Flag size={18} /><h2>Question active</h2></div>
            <QuestionStage state={snapshot.state} teams={snapshot.teams} />
            <div className="button-row">
              <button onClick={() => api('/api/game/state', { method: 'POST', body: JSON.stringify({ revealAnswer: !snapshot.state.revealAnswer }) })}>
                {snapshot.state.revealAnswer ? <EyeOff size={17} /> : <Eye size={17} />}
                {snapshot.state.revealAnswer ? 'Masquer' : 'Reveler'}
              </button>
              <button onClick={() => api('/api/game/state', { method: 'POST', body: JSON.stringify({ currentQuestionId: null, revealAnswer: false, answerStatus: '' }) })}>Vider ecran</button>
              <button onClick={() => api('/api/game/state', { method: 'POST', body: JSON.stringify({ publicQrVisible: !snapshot.state.publicQrVisible }) })}>
                {snapshot.state.publicQrVisible ? 'Masquer QR public' : 'Afficher QR public'}
              </button>
            </div>
          </section>}

          <section className="admin-panel compact-tool">
            <div className="section-title"><FileUp size={18} /><h2>Import CSV</h2></div>
            <label className="file-button">
              Importer questions
              <input type="file" accept=".csv" onChange={(event) => importCsv(event.target.files?.[0])} />
            </label>
            <code>order,round,pool,type,theme,prompt,answer,imageUrl,imageUrlB,optionA,optionB,optionC,optionD,durationSeconds,blurLevel</code>
            {csvStatus && <p className="success">{csvStatus}</p>}
            <button className="danger" onClick={() => api('/api/questions', { method: 'DELETE' })}>Supprimer les questions</button>
          </section>

          {showTimer && <section className="admin-panel compact-tool">
            <div className="section-title"><AlarmClock size={18} /><h2>Timer</h2></div>
            <div className="timer-presets">
              {[60, 300, 600, 900].map((seconds) => (
                <button key={seconds} onClick={() => api('/api/timer/start', { method: 'POST', body: JSON.stringify({ seconds, label: `${seconds / 60} min` }) })}>{seconds / 60} min</button>
              ))}
              <button onClick={() => api('/api/timer/stop', { method: 'POST' })}><TimerReset size={16} /> Stop</button>
            </div>
            <TimerDisplay state={snapshot.state} />
          </section>}

          {isBuzzRound && <RoundThreePanel snapshot={snapshot} />}

          {isDrawing && <DrawingPanel snapshot={snapshot} />}

          {isPreRoundOne && <PreRoundPanel snapshot={snapshot} step={1} />}

          {isPreRoundTwo && <PreRoundPanel snapshot={snapshot} step={2} />}

          {isRoundOne && (
            <RoundOnePanel snapshot={snapshot} />
          )}

          {isChain && <RoundTwoPanel snapshot={snapshot} />}

          {isStroop && <StroopPanel snapshot={snapshot} />}

          {isDragon && <DragonPanel snapshot={snapshot} />}

          {showGenericQuestions && <section className="admin-panel wide">
            <div className="section-title"><ImageIcon size={18} /><h2>Questions de la manche</h2></div>
            <div className="question-table">
              {currentRoundQuestions.map((question) => (
                <article key={question.id}>
                  <span>#{question.order}</span>
                  <strong>{question.prompt}</strong>
                  <small>{question.type} | {question.theme}</small>
                  <button onClick={() => api('/api/game/state', { method: 'POST', body: JSON.stringify({ currentQuestionId: question.id, revealAnswer: false, answerStatus: '', publicMode: 'question' }) })}>Afficher</button>
                </article>
              ))}
              {!currentRoundQuestions.length && <p className="muted">Importe un CSV pour remplir cette manche.</p>}
            </div>
          </section>}
        </div>
      </section>
    </main>
  );
}

function Buzzer({ snapshot }) {
  const isSlotBuzzer = window.location.pathname.startsWith('/buzzer-slot/');
  const rawId = Number(window.location.pathname.split('/').pop());
  const slotTeamId = isSlotBuzzer ? Number((snapshot.state.roundThreeTeamIds || [])[rawId - 1]) : null;
  const teamId = isSlotBuzzer ? slotTeamId : rawId;
  const isPreRound = ['premanche1', 'premanche2'].includes(snapshot.state.roundKey);
  const preRoundTeam = getPreRoundTeams(snapshot.state).find((item) => Number(item.id) === teamId);
  const team = isPreRound ? preRoundTeam : snapshot.teams.find((item) => item.id === teamId);
  const [message, setMessage] = useState('');
  async function buzz() {
    try {
      await api(isSlotBuzzer ? `/api/buzzer-slot/${rawId}` : `/api/buzzer/${teamId}`, { method: 'POST' });
      setMessage('Buzz envoye');
    } catch (err) {
      setMessage(err.message);
    }
  }
  return (
    <main className="phone-page buzzer-page">
      <h1>{team?.name || (isSlotBuzzer ? `Buzzer ${rawId}` : 'Buzzer')}</h1>
      {isSlotBuzzer && <p>Lie a l equipe selectionnee dans les Joutes du Savoir.</p>}
      {isPreRound && <p>{snapshot.state.roundKey === 'premanche2' ? 'Prémanche visuelle' : 'Prémanche sonore'}</p>}
      <button disabled={snapshot.state.buzzLocked} onClick={buzz}>BUZZ</button>
      <p>{snapshot.state.buzzLocked ? 'Buzzer verrouille' : message || 'Pret'}</p>
    </main>
  );
}

function VotePage({ snapshot }) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  async function vote(optionId) {
    try {
      await api('/api/vote', { method: 'POST', body: JSON.stringify({ optionId }) });
      setDone(true);
    } catch (err) {
      setError(err.message);
    }
  }
  return (
    <main className="phone-page vote-page">
      <h1>{snapshot.state.voteTitle || 'Vote du public'}</h1>
      {!snapshot.state.voteOpen && <p>Le vote est ferme.</p>}
      {snapshot.state.voteOpen && !done && snapshot.state.voteOptions.map((option) => (
        <button key={option.id} onClick={() => vote(option.id)}>{option.label}</button>
      ))}
      {done && <p>Vote enregistre, merci.</p>}
      {error && <p className="error">{error}</p>}
    </main>
  );
}

function App() {
  const { snapshot, error, refresh } = useLive();
  const path = window.location.pathname;
  const displaySnapshot = useMemo(() => ({
    ...snapshot,
    teams: snapshot.teams.map((team, index) => ({
      ...team,
      name: houseTeams[index]?.name || team.name,
      logo: houseTeams[index]?.logo || ''
    }))
  }), [snapshot]);

  return useMemo(() => {
    if (path.startsWith('/admin')) return <Admin snapshot={displaySnapshot} refresh={refresh} error={error} />;
    if (path.startsWith('/screen')) return <PublicScreen snapshot={displaySnapshot} />;
    if (path.startsWith('/buzzer-slot/')) return <Buzzer snapshot={displaySnapshot} />;
    if (path.startsWith('/buzzer/')) return <Buzzer snapshot={displaySnapshot} />;
    if (path.startsWith('/vote')) return <VotePage snapshot={displaySnapshot} />;
    return <PublicScreen snapshot={displaySnapshot} />;
  }, [path, displaySnapshot, error]);
}

createRoot(document.getElementById('root')).render(<App />);
