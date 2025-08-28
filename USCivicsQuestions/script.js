document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const mainTitleEl = document.getElementById('main-title');
    const langLabelEl = document.getElementById('lang-label');
    const orderLabelEl = document.getElementById('order-label');
    const langEnBtn = document.getElementById('lang-en');
    const langPtBtn = document.getElementById('lang-pt');
    const orderSeqBtn = document.getElementById('order-seq');
    const orderRandBtn = document.getElementById('order-rand');
    const card = document.getElementById('card');
    const questionNumberEl = document.getElementById('question-number');
    const questionTextEl = document.getElementById('question-text');
    const answerTextEl = document.getElementById('answer-text');
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const progressTextEl = document.getElementById('progress-text');
    const quizModeLinkEl = document.getElementById('quiz-mode-link');

    // State
    let questions = [];
    let currentIndex = 0;
    let currentLanguage = 'en';
    let isRandomOrder = false;

    // --- Translations ---
    const translations = {
        en: {
            mainTitle: 'US Civics Questions',
            langLabel: 'Language:',
            orderLabel: 'Order:',
            orderSeq: 'Sequential',
            orderRand: 'Random',
            prevBtn: 'Previous',
            nextBtn: 'Next',
            quizModeLink: 'Try Quiz Mode →',
            noQuestions: 'No questions loaded.',
            loadingError: (fileName) => `Error loading questions. Please make sure the file '${fileName}' is in the correct directory.`
        },
        pt: {
            mainTitle: 'Questões de Cidadania Americana',
            langLabel: 'Idioma:',
            orderLabel: 'Ordem:',
            orderSeq: 'Sequencial',
            orderRand: 'Aleatório',
            prevBtn: 'Anterior',
            nextBtn: 'Próximo',
            quizModeLink: 'Experimentar Modo Quiz →',
            noQuestions: 'Nenhuma questão carregada.',
            loadingError: (fileName) => `Erro ao carregar as questões. Por favor, verifique se o ficheiro '${fileName}' está no diretório correto.`
        }
    };

    function updateUIText(language) {
        const t = translations[language];
        mainTitleEl.textContent = t.mainTitle;
        langLabelEl.textContent = t.langLabel;
        orderLabelEl.textContent = t.orderLabel;
        orderSeqBtn.textContent = t.orderSeq;
        orderRandBtn.textContent = t.orderRand;
        prevBtn.textContent = t.prevBtn;
        nextBtn.textContent = t.nextBtn;
        quizModeLinkEl.textContent = t.quizModeLink;
    }

    // --- Data Loading and Parsing ---
    async function loadQuestions(language) {
        const fileName = language === 'pt' ? 'portugues.txt' : 'english.txt';
        try {
            const response = await fetch(fileName);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const text = await response.text();
            return parseQuestions(text);
        } catch (error) {
            console.error(`Failed to load or parse ${fileName}:`, error);
            questionTextEl.textContent = translations[currentLanguage].loadingError(fileName);
            return [];
        }
    }

    function parseQuestions(text) {
        const lines = text.trim().split('\n');
        const parsedQuestions = [];
        let i = 0;
        while (i < lines.length) {
            const line = lines[i].trim();
            if (line) {
                const match = line.match(/^(\d+)\.\s*(.*)/);
                if (match) {
                    const id = parseInt(match[1], 10);
                    const question = match[2];
                    
                    // Collect all answer lines that start with ▪
                    const answerLines = [];
                    let j = i + 1;
                    while (j < lines.length) {
                        const answerLine = lines[j].trim();
                        if (answerLine.startsWith('▪')) {
                            answerLines.push(answerLine);
                            j++;
                        } else if (answerLine === '') {
                            j++;
                        } else {
                            break;
                        }
                    }
                    
                    const answer = answerLines.length > 0 ? answerLines.join('\n') : 'No answer found.';
                    parsedQuestions.push({ id, question, answer });
                    i = j;
                } else {
                    i++;
                }
            } else {
                i++;
            }
        }
        return parsedQuestions;
    }

    // --- UI and State Management ---
    function displayQuestion() {
        if (questions.length === 0) {
            progressTextEl.textContent = '0 / 0';
            questionTextEl.textContent = translations[currentLanguage].noQuestions;
            answerTextEl.textContent = '';
            questionNumberEl.textContent = '';
            return;
        }

        const updateContent = () => {
            const question = questions[currentIndex];
            questionNumberEl.textContent = `#${question.id}`;
            questionTextEl.textContent = question.question;
            answerTextEl.textContent = question.answer;
            progressTextEl.textContent = `${currentIndex + 1} / ${questions.length}`;
        };

        if (card.classList.contains('flipped')) {
            card.addEventListener('transitionend', function handler() {
                updateContent();
                card.removeEventListener('transitionend', handler);
            });
            card.classList.remove('flipped');
        } else {
            updateContent();
        }
    }

    function shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }

    async function setupStudySet() {
        updateUIText(currentLanguage);
        const loadedQuestions = await loadQuestions(currentLanguage);
        questions = [...loadedQuestions];

        if (isRandomOrder) {
            shuffleArray(questions);
        } else {
            questions.sort((a, b) => a.id - b.id);
        }
        
        currentIndex = 0;
        displayQuestion();
    }

    // --- Event Listeners ---
    card.addEventListener('click', () => {
        card.classList.toggle('flipped');
    });

    nextBtn.addEventListener('click', () => {
        if (currentIndex < questions.length - 1) {
            currentIndex++;
            displayQuestion();
        }
    });

    prevBtn.addEventListener('click', () => {
        if (currentIndex > 0) {
            currentIndex--;
            displayQuestion();
        }
    });

    langEnBtn.addEventListener('click', () => {
        if (currentLanguage === 'en') return;
        currentLanguage = 'en';
        langEnBtn.classList.add('active');
        langPtBtn.classList.remove('active');
        setupStudySet();
    });

    langPtBtn.addEventListener('click', () => {
        if (currentLanguage === 'pt') return;
        currentLanguage = 'pt';
        langPtBtn.classList.add('active');
        langEnBtn.classList.remove('active');
        setupStudySet();
    });

    orderSeqBtn.addEventListener('click', () => {
        if (!isRandomOrder) return;
        isRandomOrder = false;
        orderSeqBtn.classList.add('active');
        orderRandBtn.classList.remove('active');
        setupStudySet();
    });

    orderRandBtn.addEventListener('click', () => {
        if (isRandomOrder) return;
        isRandomOrder = true;
        orderRandBtn.classList.add('active');
        orderSeqBtn.classList.remove('active');
        setupStudySet();
    });

    // --- Initialization ---
    function init() {
        setupStudySet();
    }

    init();
});