// ==================== EXERCISE DATA ====================

// Category display abbreviations (UI only — Firestore values stay as full names)
const CATEGORY_ABBREV = {
  'Quadriceps': 'QUAD',
  'Hamstrings': 'HAM',
  'Glutes':     'GLUTE',
  'Calves':     'CALF',
  'Back':       'BACK',
  'Chest':      'CHEST',
  'Shoulders':  'DELT',
  'Biceps':     'BICEP',
  'Triceps':    'TRICEP',
  'Forearms':   'FOREARM',
  'Core':       'CORE',
};

// Ordered list for chip display (Cardio/Full Body/Other excluded from Library)
const LIBRARY_CATEGORIES = [
  'Quadriceps','Hamstrings','Glutes','Calves',
  'Back','Chest',
  'Shoulders',
  'Biceps','Triceps','Forearms',
  'Core'
];

// Category tier order for badge rendering (multi-category sorting)
const CATEGORY_TIER_ORDER = [
  'Quadriceps','Hamstrings','Glutes','Calves',
  'Back','Chest',
  'Shoulders',
  'Biceps','Triceps','Forearms',
  'Core'
];

// Body parts list used elsewhere in app (preserved for backward compatibility)
const BODY_PARTS = ['All','Quadriceps','Hamstrings','Calves','Glutes','Back','Chest','Shoulders','Biceps','Triceps','Forearms','Core','Cardio','Full Body','Other'];

const EXRX_LINKS = {
  'e1':  'https://exrx.net/WeightExercises/Quadriceps/BBSquat',
  'e2':  'https://exrx.net/WeightExercises/Quadriceps/BBFrontSquat',
  'e3':  'https://exrx.net/WeightExercises/Quadriceps/LVLegPress',
  'e4':  'https://exrx.net/WeightExercises/Quadriceps/BBHackSquat',
  'e5':  'https://exrx.net/WeightExercises/Quadriceps/LVLegExtension',
  'e6':  'https://exrx.net/WeightExercises/Quadriceps/DBSingleLegSplit',
  'e7':  'https://exrx.net/WeightExercises/Quadriceps/DBLunge',
  'e8':  'https://exrx.net/WeightExercises/Quadriceps/BWIliacusFlex',
  'e10': 'https://exrx.net/WeightExercises/Hamstrings/BBRomanianDeadlift',
  'e11': 'https://exrx.net/WeightExercises/Hamstrings/LVLegCurl',
  'e12': 'https://exrx.net/WeightExercises/Hamstrings/LVSeatedLegCurl',
  'e13': 'https://exrx.net/WeightExercises/Hamstrings/BWNordicHamstringCurl',
  'e14': 'https://exrx.net/WeightExercises/Hamstrings/BBStiffLegDeadlift',
  'e15': 'https://exrx.net/WeightExercises/Hamstrings/BBGoodMorning',
  'e20': 'https://exrx.net/WeightExercises/Gastrocnemius/LVStandingCalfRaise',
  'e21': 'https://exrx.net/WeightExercises/Soleus/LVSeatedCalfRaise',
  'e22': 'https://exrx.net/WeightExercises/Gastrocnemius/LVDonkeyCalfRaise',
  'e23': 'https://exrx.net/WeightExercises/Gastrocnemius/BWOneFootCalfRaise',
  'e30': 'https://exrx.net/WeightExercises/Gluteus/BBHipThrust',
  'e31': 'https://exrx.net/WeightExercises/Gluteus/BWGluteaBridge',
  'e32': 'https://exrx.net/WeightExercises/Gluteus/CBHipExtension',
  'e40': 'https://exrx.net/WeightExercises/ErectorSpinae/BBDeadlift',
  'e41': 'https://exrx.net/WeightExercises/BackGeneral/BBBentOverRow',
  'e42': 'https://exrx.net/WeightExercises/BackGeneral/DBBentOverRow',
  'e43': 'https://exrx.net/WeightExercises/LatissimusDorsi/BWPullUp',
  'e44': 'https://exrx.net/WeightExercises/LatissimusDorsi/BWChinUp',
  'e45': 'https://exrx.net/WeightExercises/LatissimusDorsi/CBFrontPullDown',
  'e46': 'https://exrx.net/WeightExercises/BackGeneral/CBSeatedRow',
  'e47': 'https://exrx.net/WeightExercises/BackGeneral/LVTBarRow',
  'e48': 'https://exrx.net/WeightExercises/DeltoidPosterior/CBFacePull',
  'e49': 'https://exrx.net/WeightExercises/TrapeziusMiddle/BBShrug',
  'e50': 'https://exrx.net/WeightExercises/PectoralSternal/BBBenchPress',
  'e51': 'https://exrx.net/WeightExercises/PectoralClavicular/BBInclineBenchPress',
  'e52': 'https://exrx.net/WeightExercises/PectoralSternal/BBDeclineBenchPress',
  'e53': 'https://exrx.net/WeightExercises/PectoralSternal/DBBenchPress',
  'e54': 'https://exrx.net/WeightExercises/PectoralClavicular/DBInclineBenchPress',
  'e55': 'https://exrx.net/WeightExercises/PectoralSternal/CBCrossover',
  'e56': 'https://exrx.net/WeightExercises/PectoralSternal/DBFly',
  'e57': 'https://exrx.net/WeightExercises/PectoralSternal/BWDip',
  'e58': 'https://exrx.net/WeightExercises/PectoralSternal/BWPushUp',
  'e60': 'https://exrx.net/WeightExercises/DeltoidAnterior/BBMilitaryPress',
  'e61': 'https://exrx.net/WeightExercises/DeltoidAnterior/DBSeatedPress',
  'e62': 'https://exrx.net/WeightExercises/DeltoidLateral/DBLateralRaise',
  'e63': 'https://exrx.net/WeightExercises/DeltoidAnterior/DBFrontRaise',
  'e64': 'https://exrx.net/WeightExercises/DeltoidPosterior/DBBentLateralRaise',
  'e65': 'https://exrx.net/WeightExercises/DeltoidAnterior/DBArnoldPress',
  'e66': 'https://exrx.net/WeightExercises/DeltoidLateral/CBLateralRaise',
  'e70': 'https://exrx.net/WeightExercises/Biceps/BBCurl',
  'e71': 'https://exrx.net/WeightExercises/Biceps/DBCurl',
  'e72': 'https://exrx.net/WeightExercises/Brachioradialis/DBHammerCurl',
  'e73': 'https://exrx.net/WeightExercises/Biceps/BBPreacherCurl',
  'e74': 'https://exrx.net/WeightExercises/Biceps/CBCurl',
  'e75': 'https://exrx.net/WeightExercises/Biceps/DBConcentrationCurl',
  'e76': 'https://exrx.net/WeightExercises/Biceps/DBInclineCurl',
  'e80': 'https://exrx.net/WeightExercises/Triceps/CBPushDown',
  'e81': 'https://exrx.net/WeightExercises/Triceps/BBLyingTriExtension',
  'e82': 'https://exrx.net/WeightExercises/Triceps/BBCloseGripBenchPress',
  'e83': 'https://exrx.net/WeightExercises/Triceps/DBTriExtension',
  'e84': 'https://exrx.net/WeightExercises/Triceps/DBKickback',
  'e85': 'https://exrx.net/WeightExercises/Triceps/BWDiamondPushUp',
  'e90': 'https://exrx.net/WeightExercises/WristFlexors/BBWristCurl',
  'e91': 'https://exrx.net/WeightExercises/WristExtensors/BBReverseWristCurl',
  'e92': 'https://exrx.net/WeightExercises/Forearm/DBFarmerWalk',
  'e100':'https://exrx.net/WeightExercises/Iliopsoas/BWPlank',
  'e101':'https://exrx.net/WeightExercises/RectusAbdominis/BWCrunch',
  'e102':'https://exrx.net/WeightExercises/RectusAbdominis/CBCrunch',
  'e103':'https://exrx.net/WeightExercises/Iliopsoas/BWHangingLegRaise',
  'e104':'https://exrx.net/WeightExercises/RectusAbdominis/BWAbWheelRollout',
  'e105':'https://exrx.net/WeightExercises/Obliques/BWRussianTwist',
  'e110':'https://exrx.net/Aerobic/Activities/Treadmill',
  'e111':'https://exrx.net/Aerobic/Activities/StationaryBicycle',
  'e112':'https://exrx.net/Aerobic/Activities/Elliptical',
  'e113':'https://exrx.net/Aerobic/Activities/JumpRope',
};

// DEFAULT_EXERCISES now includes categories[] (array), movementStructure, executionStyle.
// 'bodypart' is retained for backward compatibility with existing workout history.
const DEFAULT_EXERCISES = [
  // QUADRICEPS
  {id:'e1', name:'Back Squat',          bodypart:'Quadriceps', categories:['Quadriceps','Glutes'],           movementStructure:'Compound',  executionStyle:'Bilateral',   tracking:'weight_reps',    custom:false},
  {id:'e2', name:'Front Squat',          bodypart:'Quadriceps', categories:['Quadriceps','Glutes'],           movementStructure:'Compound',  executionStyle:'Bilateral',   tracking:'weight_reps',    custom:false},
  {id:'e3', name:'Leg Press',            bodypart:'Quadriceps', categories:['Quadriceps','Glutes'],           movementStructure:'Compound',  executionStyle:'Bilateral',   tracking:'weight_reps',    custom:false},
  {id:'e4', name:'Hack Squat',           bodypart:'Quadriceps', categories:['Quadriceps','Glutes'],           movementStructure:'Compound',  executionStyle:'Bilateral',   tracking:'weight_reps',    custom:false},
  {id:'e5', name:'Leg Extension',        bodypart:'Quadriceps', categories:['Quadriceps'],                    movementStructure:'Isolation', executionStyle:'Bilateral',   tracking:'weight_reps',    custom:false},
  {id:'e6', name:'Bulgarian Split Squat',bodypart:'Quadriceps', categories:['Quadriceps','Glutes'],           movementStructure:'Compound',  executionStyle:'Unilateral',  tracking:'weight_reps',    custom:false},
  {id:'e7', name:'Walking Lunge',        bodypart:'Quadriceps', categories:['Quadriceps','Glutes'],           movementStructure:'Compound',  executionStyle:'Unilateral',  tracking:'weight_reps',    custom:false},
  {id:'e8', name:'Sissy Squat',          bodypart:'Quadriceps', categories:['Quadriceps'],                    movementStructure:'Isolation', executionStyle:'Bilateral',   tracking:'bodyweight_reps',custom:false},
  // HAMSTRINGS
  {id:'e10',name:'Romanian Deadlift',    bodypart:'Hamstrings', categories:['Hamstrings','Glutes'],           movementStructure:'Compound',  executionStyle:'Bilateral',   tracking:'weight_reps',    custom:false},
  {id:'e11',name:'Leg Curl (Lying)',     bodypart:'Hamstrings', categories:['Hamstrings'],                    movementStructure:'Isolation', executionStyle:'Bilateral',   tracking:'weight_reps',    custom:false},
  {id:'e12',name:'Leg Curl (Seated)',    bodypart:'Hamstrings', categories:['Hamstrings'],                    movementStructure:'Isolation', executionStyle:'Bilateral',   tracking:'weight_reps',    custom:false},
  {id:'e13',name:'Nordic Hamstring Curl',bodypart:'Hamstrings', categories:['Hamstrings'],                    movementStructure:'Isolation', executionStyle:'Bilateral',   tracking:'bodyweight_reps',custom:false},
  {id:'e14',name:'Stiff-Leg Deadlift',   bodypart:'Hamstrings', categories:['Hamstrings','Glutes'],           movementStructure:'Compound',  executionStyle:'Bilateral',   tracking:'weight_reps',    custom:false},
  {id:'e15',name:'Good Morning',         bodypart:'Hamstrings', categories:['Hamstrings','Glutes'],           movementStructure:'Compound',  executionStyle:'Bilateral',   tracking:'weight_reps',    custom:false},
  // CALVES
  {id:'e20',name:'Standing Calf Raise',  bodypart:'Calves',     categories:['Calves'],                        movementStructure:'Isolation', executionStyle:'Bilateral',   tracking:'weight_reps',    custom:false},
  {id:'e21',name:'Seated Calf Raise',    bodypart:'Calves',     categories:['Calves'],                        movementStructure:'Isolation', executionStyle:'Bilateral',   tracking:'weight_reps',    custom:false},
  {id:'e22',name:'Donkey Calf Raise',    bodypart:'Calves',     categories:['Calves'],                        movementStructure:'Isolation', executionStyle:'Bilateral',   tracking:'weight_reps',    custom:false},
  {id:'e23',name:'Single-Leg Calf Raise',bodypart:'Calves',     categories:['Calves'],                        movementStructure:'Isolation', executionStyle:'Unilateral',  tracking:'bodyweight_reps',custom:false},
  // GLUTES
  {id:'e30',name:'Hip Thrust',           bodypart:'Glutes',     categories:['Glutes','Hamstrings'],           movementStructure:'Compound',  executionStyle:'Bilateral',   tracking:'weight_reps',    custom:false},
  {id:'e31',name:'Glute Bridge',         bodypart:'Glutes',     categories:['Glutes','Hamstrings'],           movementStructure:'Compound',  executionStyle:'Bilateral',   tracking:'weight_reps',    custom:false},
  {id:'e32',name:'Cable Kickback',       bodypart:'Glutes',     categories:['Glutes'],                        movementStructure:'Isolation', executionStyle:'Unilateral',  tracking:'weight_reps',    custom:false},
  // BACK
  {id:'e40',name:'Deadlift',             bodypart:'Back',       categories:['Back','Hamstrings','Glutes'],    movementStructure:'Compound',  executionStyle:'Bilateral',   tracking:'weight_reps',    custom:false},
  {id:'e41',name:'Barbell Row',          bodypart:'Back',       categories:['Back'],                          movementStructure:'Compound',  executionStyle:'Bilateral',   tracking:'weight_reps',    custom:false},
  {id:'e42',name:'Dumbbell Row',         bodypart:'Back',       categories:['Back'],                          movementStructure:'Compound',  executionStyle:'Unilateral',  tracking:'weight_reps',    custom:false},
  {id:'e43',name:'Pull-Up',              bodypart:'Back',       categories:['Back','Biceps'],                 movementStructure:'Compound',  executionStyle:'Bilateral',   tracking:'bodyweight_reps',custom:false},
  {id:'e44',name:'Chin-Up',              bodypart:'Back',       categories:['Back','Biceps'],                 movementStructure:'Compound',  executionStyle:'Bilateral',   tracking:'bodyweight_reps',custom:false},
  {id:'e45',name:'Lat Pulldown',         bodypart:'Back',       categories:['Back'],                          movementStructure:'Compound',  executionStyle:'Bilateral',   tracking:'weight_reps',    custom:false},
  {id:'e46',name:'Seated Cable Row',     bodypart:'Back',       categories:['Back'],                          movementStructure:'Compound',  executionStyle:'Bilateral',   tracking:'weight_reps',    custom:false},
  {id:'e47',name:'T-Bar Row',            bodypart:'Back',       categories:['Back'],                          movementStructure:'Compound',  executionStyle:'Bilateral',   tracking:'weight_reps',    custom:false},
  {id:'e48',name:'Face Pull',            bodypart:'Back',       categories:['Back','Shoulders'],              movementStructure:'Compound',  executionStyle:'Bilateral',   tracking:'weight_reps',    custom:false},
  {id:'e49',name:'Shrug',                bodypart:'Back',       categories:['Back'],                          movementStructure:'Isolation', executionStyle:'Bilateral',   tracking:'weight_reps',    custom:false},
  // CHEST
  {id:'e50',name:'Barbell Bench Press',  bodypart:'Chest',      categories:['Chest','Triceps'],               movementStructure:'Compound',  executionStyle:'Bilateral',   tracking:'weight_reps',    custom:false},
  {id:'e51',name:'Incline Bench Press',  bodypart:'Chest',      categories:['Chest','Triceps'],               movementStructure:'Compound',  executionStyle:'Bilateral',   tracking:'weight_reps',    custom:false},
  {id:'e52',name:'Decline Bench Press',  bodypart:'Chest',      categories:['Chest','Triceps'],               movementStructure:'Compound',  executionStyle:'Bilateral',   tracking:'weight_reps',    custom:false},
  {id:'e53',name:'Dumbbell Bench Press', bodypart:'Chest',      categories:['Chest','Triceps'],               movementStructure:'Compound',  executionStyle:'Bilateral',   tracking:'weight_reps',    custom:false},
  {id:'e54',name:'Incline Dumbbell Press',bodypart:'Chest',     categories:['Chest','Triceps'],               movementStructure:'Compound',  executionStyle:'Bilateral',   tracking:'weight_reps',    custom:false},
  {id:'e55',name:'Cable Fly',            bodypart:'Chest',      categories:['Chest'],                         movementStructure:'Isolation', executionStyle:'Bilateral',   tracking:'weight_reps',    custom:false},
  {id:'e56',name:'Dumbbell Fly',         bodypart:'Chest',      categories:['Chest'],                         movementStructure:'Isolation', executionStyle:'Bilateral',   tracking:'weight_reps',    custom:false},
  {id:'e57',name:'Dip',                  bodypart:'Chest',      categories:['Chest','Triceps'],               movementStructure:'Compound',  executionStyle:'Bilateral',   tracking:'bodyweight_reps',custom:false},
  {id:'e58',name:'Push-Up',              bodypart:'Chest',      categories:['Chest','Triceps'],               movementStructure:'Compound',  executionStyle:'Bilateral',   tracking:'bodyweight_reps',custom:false},
  // SHOULDERS
  {id:'e60',name:'Overhead Press (Barbell)',  bodypart:'Shoulders',categories:['Shoulders','Triceps'],        movementStructure:'Compound',  executionStyle:'Bilateral',   tracking:'weight_reps',    custom:false},
  {id:'e61',name:'Overhead Press (Dumbbell)', bodypart:'Shoulders',categories:['Shoulders','Triceps'],        movementStructure:'Compound',  executionStyle:'Bilateral',   tracking:'weight_reps',    custom:false},
  {id:'e62',name:'Lateral Raise',        bodypart:'Shoulders',  categories:['Shoulders'],                     movementStructure:'Isolation', executionStyle:'Bilateral',   tracking:'weight_reps',    custom:false},
  {id:'e63',name:'Front Raise',          bodypart:'Shoulders',  categories:['Shoulders'],                     movementStructure:'Isolation', executionStyle:'Bilateral',   tracking:'weight_reps',    custom:false},
  {id:'e64',name:'Rear Delt Fly',        bodypart:'Shoulders',  categories:['Shoulders'],                     movementStructure:'Isolation', executionStyle:'Bilateral',   tracking:'weight_reps',    custom:false},
  {id:'e65',name:'Arnold Press',         bodypart:'Shoulders',  categories:['Shoulders','Triceps'],           movementStructure:'Compound',  executionStyle:'Bilateral',   tracking:'weight_reps',    custom:false},
  {id:'e66',name:'Cable Lateral Raise',  bodypart:'Shoulders',  categories:['Shoulders'],                     movementStructure:'Isolation', executionStyle:'Unilateral',  tracking:'weight_reps',    custom:false},
  // BICEPS
  {id:'e70',name:'Barbell Curl',         bodypart:'Biceps',     categories:['Biceps'],                        movementStructure:'Isolation', executionStyle:'Bilateral',   tracking:'weight_reps',    custom:false},
  {id:'e71',name:'Dumbbell Curl',        bodypart:'Biceps',     categories:['Biceps'],                        movementStructure:'Isolation', executionStyle:'Bilateral',   tracking:'weight_reps',    custom:false},
  {id:'e72',name:'Hammer Curl',          bodypart:'Biceps',     categories:['Biceps','Forearms'],             movementStructure:'Isolation', executionStyle:'Bilateral',   tracking:'weight_reps',    custom:false},
  {id:'e73',name:'Preacher Curl',        bodypart:'Biceps',     categories:['Biceps'],                        movementStructure:'Isolation', executionStyle:'Bilateral',   tracking:'weight_reps',    custom:false},
  {id:'e74',name:'Cable Curl',           bodypart:'Biceps',     categories:['Biceps'],                        movementStructure:'Isolation', executionStyle:'Bilateral',   tracking:'weight_reps',    custom:false},
  {id:'e75',name:'Concentration Curl',   bodypart:'Biceps',     categories:['Biceps'],                        movementStructure:'Isolation', executionStyle:'Unilateral',  tracking:'weight_reps',    custom:false},
  {id:'e76',name:'Incline Dumbbell Curl',bodypart:'Biceps',     categories:['Biceps'],                        movementStructure:'Isolation', executionStyle:'Bilateral',   tracking:'weight_reps',    custom:false},
  // TRICEPS
  {id:'e80',name:'Tricep Pushdown (Cable)',bodypart:'Triceps',  categories:['Triceps'],                       movementStructure:'Isolation', executionStyle:'Bilateral',   tracking:'weight_reps',    custom:false},
  {id:'e81',name:'Skull Crusher',        bodypart:'Triceps',    categories:['Triceps'],                       movementStructure:'Isolation', executionStyle:'Bilateral',   tracking:'weight_reps',    custom:false},
  {id:'e82',name:'Close Grip Bench Press',bodypart:'Triceps',   categories:['Triceps','Chest'],               movementStructure:'Compound',  executionStyle:'Bilateral',   tracking:'weight_reps',    custom:false},
  {id:'e83',name:'Overhead Tricep Extension',bodypart:'Triceps',categories:['Triceps'],                       movementStructure:'Isolation', executionStyle:'Bilateral',   tracking:'weight_reps',    custom:false},
  {id:'e84',name:'Tricep Kickback',      bodypart:'Triceps',    categories:['Triceps'],                       movementStructure:'Isolation', executionStyle:'Unilateral',  tracking:'weight_reps',    custom:false},
  {id:'e85',name:'Diamond Push-Up',      bodypart:'Triceps',    categories:['Triceps','Chest'],               movementStructure:'Compound',  executionStyle:'Bilateral',   tracking:'bodyweight_reps',custom:false},
  // FOREARMS
  {id:'e90',name:'Wrist Curl',           bodypart:'Forearms',   categories:['Forearms'],                      movementStructure:'Isolation', executionStyle:'Bilateral',   tracking:'weight_reps',    custom:false},
  {id:'e91',name:'Reverse Wrist Curl',   bodypart:'Forearms',   categories:['Forearms'],                      movementStructure:'Isolation', executionStyle:'Bilateral',   tracking:'weight_reps',    custom:false},
  {id:'e92',name:'Farmer Carry',         bodypart:'Forearms',   categories:['Forearms','Back'],               movementStructure:'Compound',  executionStyle:'Bilateral',   tracking:'weight_time',    custom:false},
  // CORE
  {id:'e100',name:'Plank',              bodypart:'Core',        categories:['Core'],                          movementStructure:'Compound',  executionStyle:'Bilateral',   tracking:'time',           custom:false},
  {id:'e101',name:'Crunch',             bodypart:'Core',        categories:['Core'],                          movementStructure:'Isolation', executionStyle:'Bilateral',   tracking:'bodyweight_reps',custom:false},
  {id:'e102',name:'Cable Crunch',       bodypart:'Core',        categories:['Core'],                          movementStructure:'Isolation', executionStyle:'Bilateral',   tracking:'weight_reps',    custom:false},
  {id:'e103',name:'Hanging Leg Raise',  bodypart:'Core',        categories:['Core'],                          movementStructure:'Compound',  executionStyle:'Bilateral',   tracking:'bodyweight_reps',custom:false},
  {id:'e104',name:'Ab Wheel Rollout',   bodypart:'Core',        categories:['Core'],                          movementStructure:'Compound',  executionStyle:'Bilateral',   tracking:'bodyweight_reps',custom:false},
  {id:'e105',name:'Russian Twist',      bodypart:'Core',        categories:['Core'],                          movementStructure:'Isolation', executionStyle:'Bilateral',   tracking:'bodyweight_reps',custom:false},
  // CARDIO (retained for workout history compatibility, hidden in Library)
  {id:'e110',name:'Treadmill',          bodypart:'Cardio',      categories:['Cardio'],                        movementStructure:'Compound',  executionStyle:'Bilateral',   tracking:'time',           custom:false},
  {id:'e111',name:'Stationary Bike',    bodypart:'Cardio',      categories:['Cardio'],                        movementStructure:'Compound',  executionStyle:'Bilateral',   tracking:'time',           custom:false},
  {id:'e112',name:'Elliptical',         bodypart:'Cardio',      categories:['Cardio'],                        movementStructure:'Compound',  executionStyle:'Bilateral',   tracking:'time',           custom:false},
  {id:'e113',name:'Jump Rope',          bodypart:'Cardio',      categories:['Cardio'],                        movementStructure:'Compound',  executionStyle:'Bilateral',   tracking:'time',           custom:false},
];

// ==================== EXERCISE HELPERS ====================

function getAllExercises() { return [...DEFAULT_EXERCISES, ...appDb.customExercises]; }
function getExercise(id)   { return getAllExercises().find(e => e.id === id); }

function getLastUsed(id) {
  let last = 0;
  appDb.workouts.forEach(w => { if (w.exercises.some(e => e.exerciseId === id) && w.date > last) last = w.date; });
  return last || null;
}

// Returns the effective categories array for an exercise,
// merging user overrides (for system exercises) with defaults.
function getExCategories(ex) {
  if (!ex) return [];
  // Check user overrides for system exercises
  if (!ex.custom && appDb.exOverrides && appDb.exOverrides[ex.id]) {
    const ov = appDb.exOverrides[ex.id];
    if (ov.categories) return ov.categories;
  }
  // Use categories array if present, else fall back to single bodypart
  if (ex.categories && ex.categories.length) return ex.categories;
  return ex.bodypart ? [ex.bodypart] : [];
}

// Returns the effective movementStructure for an exercise
function getExMovementStructure(ex) {
  if (!ex) return '';
  if (!ex.custom && appDb.exOverrides && appDb.exOverrides[ex.id]) {
    const ov = appDb.exOverrides[ex.id];
    if (ov.movementStructure) return ov.movementStructure;
  }
  return ex.movementStructure || '';
}

// Returns the effective executionStyle for an exercise
function getExExecutionStyle(ex) {
  if (!ex) return '';
  if (!ex.custom && appDb.exOverrides && appDb.exOverrides[ex.id]) {
    const ov = appDb.exOverrides[ex.id];
    if (ov.executionStyle) return ov.executionStyle;
  }
  return ex.executionStyle || '';
}

// Sort categories by tier order for badge rendering
function sortCategories(cats) {
  return [...cats].sort((a, b) => {
    const ai = CATEGORY_TIER_ORDER.indexOf(a);
    const bi = CATEGORY_TIER_ORDER.indexOf(b);
    const av = ai === -1 ? 999 : ai;
    const bv = bi === -1 ? 999 : bi;
    return av - bv;
  });
}

// Render category badge(s) for an exercise — sorted by tier
function renderCategoryBadges(ex, styleClass) {
  const cats = sortCategories(getExCategories(ex));
  return cats
    .filter(c => CATEGORY_ABBREV[c])
    .map(c => `<span class="${styleClass || 'ex-cat-badge'}">${CATEGORY_ABBREV[c]}</span>`)
    .join('');
}

// ==================== E1RM ====================
function calc1RM(w, r) {
  if (r === 1) return w;
  const formula = appDb.e1rmFormula || 'epley';
  if (formula === 'brzycki') { if (r >= 37) return w; return Math.round(w * (36 / (37 - r)) * 10) / 10; }
  if (formula === 'wathan')  { return Math.round(100 * w / (48.8 + 53.8 * Math.exp(-0.075 * r)) * 10) / 10; }
  return Math.round(w * (1 + r / 30) * 10) / 10;
}

function roundToIncrement(val) {
  const inc = appDb.unit === 'kg' ? 1.25 : 2.5;
  return Math.ceil(val / inc) * inc;
}

// ==================== PERFORMANCE STATS HELPERS ====================
function getPreviousPerf(exId) {
  const prev = appDb.workouts.filter(w => w.exercises.some(e => e.exerciseId === exId)).sort((a,b) => b.date-a.date)[0];
  if (!prev) return null;
  const ex = prev.exercises.find(e => e.exerciseId === exId);
  const s = ex?.sets?.[0];
  return s?.weight ? `${s.weight}${appDb.unit} \u00d7 ${s.reps||s.time}` : null;
}

function getBest1RM(exId, excludeId) {
  let best = 0;
  appDb.workouts.filter(w => excludeId ? w.id !== excludeId : true)
    .forEach(w => w.exercises.filter(e => e.exerciseId===exId)
      .forEach(e => e.sets.forEach(s => { if(s.weight&&s.reps){const v=calc1RM(+s.weight,+s.reps);if(v>best)best=v;} })));
  return best;
}

function getBestWeight(exId, excludeId) {
  let best = 0;
  appDb.workouts.filter(w => excludeId ? w.id !== excludeId : true)
    .forEach(w => w.exercises.filter(e => e.exerciseId===exId)
      .forEach(e => e.sets.forEach(s => { if(+s.weight>best)best=+s.weight; })));
  return best;
}

function getBestTime(exId) {
  let best = 0;
  appDb.workouts.forEach(w => w.exercises.filter(e=>e.exerciseId===exId)
    .forEach(e => e.sets.forEach(s=>{if(+s.time>best)best=+s.time;})));
  return best || null;
}

function getBestReps(exId) {
  let best = 0;
  appDb.workouts.forEach(w => w.exercises.filter(e=>e.exerciseId===exId)
    .forEach(e => e.sets.forEach(s=>{if(+s.reps>best)best=+s.reps;})));
  return best || null;
}

function getBestE1RMForExercise(exId, bw) {
  let best = 0;
  appDb.workouts.forEach(w => w.exercises.filter(e=>e.exerciseId===exId).forEach(e => e.sets.forEach(s=>{
    if(s.weight&&+s.weight>0&&s.reps){const v=calc1RM(+s.weight,+s.reps);if(v>best)best=v;}
    if((!s.weight||+s.weight===0)&&s.reps&&bw){const v=calc1RM(bw,+s.reps);if(v>best)best=v;}
  })));
  return best;
}

// Get best N-rep performance (used for PRs on profile)
function getBestNRM(exId, targetReps) {
  let best = 0;
  appDb.workouts.forEach(w => w.exercises.filter(e => e.exerciseId === exId).forEach(e => e.sets.forEach(s => {
    if (s.weight && s.reps && +s.reps === targetReps && +s.weight > best) best = +s.weight;
  })));
  return best || null;
}

// Get all E1RM data points for graph (one per workout session, best set per session)
function getE1RMHistory(exId) {
  const points = [];
  const sorted = [...appDb.workouts].sort((a,b) => a.date - b.date);
  sorted.forEach(w => {
    const ex = w.exercises.find(e => e.exerciseId === exId);
    if (!ex) return;
    let best = 0;
    ex.sets.forEach(s => {
      if (s.weight && s.reps) {
        const v = calc1RM(+s.weight, +s.reps);
        if (v > best) best = v;
      }
    });
    if (best > 0) points.push({ date: w.date, value: best });
  });
  return points;
}

function getExerciseStats(exId) {
  const all = [];
  appDb.workouts.forEach(w => {
    const ex = w.exercises.find(e => e.exerciseId === exId);
    if (ex) ex.sets.forEach(s => all.push(s));
  });
  appDb.importedSets.filter(s => s.exerciseId === exId).forEach(s => all.push(s));
  if (!all.length) return null;
  let bestW = 0, best1 = 0;
  all.forEach(s => {
    if (+s.weight > bestW) bestW = +s.weight;
    if (s.weight && s.reps) { const v = calc1RM(+s.weight, +s.reps); if (v > best1) best1 = v; }
  });
  const recent = all.slice(-3).reverse().map(s =>
    `${s.weight ? s.weight + appDb.unit + ' \u00d7 ' : ''}${s.reps || s.time || '?'}${s.rpe ? ' @ RPE ' + s.rpe : ''}`
  );
  return { bestWeight: bestW || null, best1rm: best1 ? Math.round(best1) : null, totalSets: all.length, recentSets: recent };
}

// ==================== UTILITIES ====================
function uid() { return 'id' + Date.now() + Math.random().toString(36).slice(2,7); }

function fmtDuration(s) {
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60;
  return h ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}` : `${m}:${String(sec).padStart(2,'0')}`;
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showToast(msg, type='') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'show ' + (type || '');
  setTimeout(() => t.className = '', 2500);
}

function confirm2(title, msg, cb, acceptLabel='Delete') {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-msg').textContent = msg;
  document.getElementById('confirm-accept-btn').textContent = acceptLabel;
  confirmCallback = cb;
  document.getElementById('confirm-overlay').classList.add('open');
}

function confirmAccept() {
  document.getElementById('confirm-overlay').classList.remove('open');
  if (confirmCallback) confirmCallback();
  confirmCallback = null;
}

function confirmReject() {
  document.getElementById('confirm-overlay').classList.remove('open');
  confirmCallback = null;
}
