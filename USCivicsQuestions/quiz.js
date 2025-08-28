document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const mainTitleEl = document.getElementById('main-title');
    const langLabelEl = document.getElementById('lang-label');
    const orderLabelEl = document.getElementById('order-label');
    const langEnBtn = document.getElementById('lang-en');
    const langPtBtn = document.getElementById('lang-pt');
    const orderSeqBtn = document.getElementById('order-seq');
    const orderRandBtn = document.getElementById('order-rand');
    const questionNumberEl = document.getElementById('question-number');
    const questionProgressEl = document.getElementById('question-progress');
    const questionTextEl = document.getElementById('question-text');
    const choicesContainerEl = document.getElementById('choices-container');
    const feedbackEl = document.getElementById('feedback');
    const nextQuestionBtn = document.getElementById('next-question');
    const correctCountEl = document.getElementById('correct-count');
    const wrongCountEl = document.getElementById('wrong-count');
    const scoreTextEl = document.getElementById('score-text');
    const flipCardsLinkEl = document.getElementById('flip-cards-link');

    // State
    let questions = [];
    let wrongChoices = [];
    let currentIndex = 0;
    let currentLanguage = 'en';
    let isRandomOrder = false;
    let correctAnswers = 0;
    let wrongAnswers = 0;
    let hasAnswered = false;

    // Translations
    const translations = {
        en: {
            mainTitle: 'US Civics Quiz',
            langLabel: 'Language:',
            orderLabel: 'Order:',
            orderSeq: 'Sequential',
            orderRand: 'Random',
            scoreText: 'Score: ',
            nextQuestion: 'Next Question',
            flipCardsLink: '← Flip Cards Mode',
            correct: 'Correct!',
            wrong: 'Wrong!',
            noQuestions: 'No questions loaded.',
            loadingError: (fileName) => `Error loading questions. Please make sure the file '${fileName}' is in the correct directory.`
        },
        pt: {
            mainTitle: 'Quiz de Cidadania Americana',
            langLabel: 'Idioma:',
            orderLabel: 'Ordem:',
            orderSeq: 'Sequencial',
            orderRand: 'Aleatório',
            scoreText: 'Pontuação: ',
            nextQuestion: 'Próxima Pergunta',
            flipCardsLink: '← Modo Cartões',
            correct: 'Correto!',
            wrong: 'Errado!',
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
        scoreTextEl.textContent = t.scoreText;
        nextQuestionBtn.textContent = t.nextQuestion;
        flipCardsLinkEl.textContent = t.flipCardsLink;
    }

    // Data Loading and Parsing
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

    async function loadWrongChoices(language) {
        const fileName = language === 'pt' ? 'wrong_choices_pt.txt' : 'wrong_choices_en.txt';
        try {
            const response = await fetch(fileName);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const text = await response.text();
            return JSON.parse(text);
        } catch (error) {
            console.error(`Failed to load wrong choices from ${fileName}:`, error);
            return {};
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
                            answerLines.push(answerLine.substring(1).trim());
                            j++;
                        } else if (answerLine === '') {
                            j++;
                        } else {
                            break;
                        }
                    }
                    
                    const answers = answerLines.length > 0 ? answerLines : ['No answer found.'];
                    parsedQuestions.push({ id, question, answers });
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

    function getWrongChoicesForQuestion(questionId, count = 3) {
        const questionWrongChoices = wrongChoices[questionId.toString()];
        if (!questionWrongChoices || !Array.isArray(questionWrongChoices)) {
            // Fallback to generic wrong choices if specific ones don't exist
            console.warn(`No specific wrong choices found for question ${questionId}, using fallback`);
            return ['Option A', 'Option B', 'Option C'].slice(0, count);
        }
        
        // Shuffle the available wrong choices and return the requested count
        const shuffled = [...questionWrongChoices].sort(() => Math.random() - 0.5);
        return shuffled.slice(0, Math.min(count, shuffled.length));
    }

    function createChoices(question) {
        const choices = [];
        
        // Add one correct answer (randomly selected if multiple)
        const correctAnswer = question.answers[Math.floor(Math.random() * question.answers.length)];
        choices.push({ text: correctAnswer, isCorrect: true });
        
        // Add wrong choices specific to this question
        const wrongChoicesForQuestion = getWrongChoicesForQuestion(question.id);
        wrongChoicesForQuestion.forEach(choice => {
            choices.push({ text: choice, isCorrect: false });
        });
        
        // Shuffle all choices
        return choices.sort(() => Math.random() - 0.5);
    }

    function displayQuestion() {
        if (questions.length === 0) {
            questionTextEl.textContent = translations[currentLanguage].noQuestions;
            choicesContainerEl.innerHTML = '';
            return;
        }

        const question = questions[currentIndex];
        questionNumberEl.textContent = `#${question.id}`;
        questionTextEl.textContent = question.question;
        questionProgressEl.textContent = `${currentIndex + 1} / ${questions.length}`;
        
        // Create and display choices
        const choices = createChoices(question);
        choicesContainerEl.innerHTML = '';
        
        choices.forEach((choice, index) => {
            const button = document.createElement('button');
            button.className = 'choice-button';
            button.textContent = choice.text;
            button.onclick = () => handleChoiceClick(button, choice.isCorrect, choices);
            choicesContainerEl.appendChild(button);
        });

        // Reset state for new question
        hasAnswered = false;
        nextQuestionBtn.disabled = true;
        feedbackEl.style.display = 'none';
    }

    function handleChoiceClick(clickedButton, isCorrect, allChoices) {
        if (hasAnswered) return;
        
        hasAnswered = true;
        
        // Disable all buttons and show correct/wrong styling
        const allButtons = choicesContainerEl.querySelectorAll('.choice-button');
        allButtons.forEach((button, index) => {
            button.disabled = true;
            button.classList.add('disabled');
            
            if (allChoices[index].isCorrect) {
                button.classList.add('correct');
            } else if (button === clickedButton) {
                button.classList.add('wrong');
            }
        });

        // Update score
        if (isCorrect) {
            correctAnswers++;
            correctCountEl.textContent = correctAnswers;
            showFeedback(translations[currentLanguage].correct, 'correct');
        } else {
            wrongAnswers++;
            wrongCountEl.textContent = wrongAnswers;
            showFeedback(translations[currentLanguage].wrong, 'wrong');
        }

        // Enable next question button
        nextQuestionBtn.disabled = false;
    }

    function showFeedback(message, type) {
        feedbackEl.textContent = message;
        feedbackEl.className = `feedback ${type}`;
        feedbackEl.style.display = 'block';
    }

    function shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }

    async function setupQuiz() {
        updateUIText(currentLanguage);
        const [loadedQuestions, loadedWrongChoices] = await Promise.all([
            loadQuestions(currentLanguage),
            loadWrongChoices(currentLanguage)
        ]);
        
        questions = [...loadedQuestions];
        wrongChoices = loadedWrongChoices;

        if (isRandomOrder) {
            shuffleArray(questions);
        } else {
            questions.sort((a, b) => a.id - b.id);
        }
        
        currentIndex = 0;
        correctAnswers = 0;
        wrongAnswers = 0;
        correctCountEl.textContent = '0';
        wrongCountEl.textContent = '0';
        
        displayQuestion();
    }

    // Event Listeners
    nextQuestionBtn.addEventListener('click', () => {
        if (currentIndex < questions.length - 1) {
            currentIndex++;
            displayQuestion();
        }
    });

    langEnBtn.addEventListener('click', () => {
        if (currentLanguage === 'en') return;
        currentLanguage = 'en';
        langEnBtn.classList.add('active');
        langPtBtn.classList.remove('active');
        setupQuiz();
    });

    langPtBtn.addEventListener('click', () => {
        if (currentLanguage === 'pt') return;
        currentLanguage = 'pt';
        langPtBtn.classList.add('active');
        langEnBtn.classList.remove('active');
        setupQuiz();
    });

    orderSeqBtn.addEventListener('click', () => {
        if (!isRandomOrder) return;
        isRandomOrder = false;
        orderSeqBtn.classList.add('active');
        orderRandBtn.classList.remove('active');
        setupQuiz();
    });

    orderRandBtn.addEventListener('click', () => {
        if (isRandomOrder) return;
        isRandomOrder = true;
        orderRandBtn.classList.add('active');
        orderSeqBtn.classList.remove('active');
        setupQuiz();
    });

    // Initialization
    setupQuiz();
});