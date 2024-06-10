const express = require('express');
const mysql = require('mysql');
const bodyParser = require('body-parser');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const app = express();

// Configurações do MySQL
const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'cheff'
});

db.connect(err => {
  if (err) {
    throw err;  
  }
  console.log('Conectado ao banco de dados MySQL');
});

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use('/imagens', express.static(path.join(__dirname, 'imagens')));

// Configuração do multer para upload de imagens
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'imagens');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });
app.use('/imagens', express.static(path.join(__dirname, 'imagens')));

// Middleware para autenticar token JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token == null) return res.sendStatus(401);

  jwt.verify(token, 'secreto', (err, user) => {
    if (err) return res.sendStatus(403);
    req.userId = user.userId;
    next();
  });
};

// Rota para cadastrar usuário no banco de dados
app.post('/register', (req, res) => {
  const { nome, senha } = req.body;

  if (!nome || !senha) {
    return res.status(400).json({ error: 'Por favor, forneça um nome e uma senha' });
  }

  const query = 'INSERT INTO user (nome, senha) VALUES (?, ?)';
  db.query(query, [nome, senha], (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Erro ao registrar usuário' });
    }

    const userId = result.insertId;

    // Inserir uma entrada vazia na tabela 'lista'
    const insertListaQuery = 'INSERT INTO lista (user_id) VALUES (?)';
    db.query(insertListaQuery, [userId], (err) => {
      if (err) {
        console.error('Erro ao inserir na tabela lista', err);
      }
    });

    // Inserir uma entrada vazia na tabela 'planejamento'
    const insertPlanejamentoQuery = 'INSERT INTO planejamento (user_id) VALUES (?)';
    db.query(insertPlanejamentoQuery, [userId], (err) => {
      if (err) {
        console.error('Erro ao inserir na tabela planejamento', err);
      }
    });

    res.status(201).json({ message: 'Usuário registrado com sucesso', userId: userId });
  });
});

// Rota para login de usuário
app.post('/login', (req, res) => {
  const { nome, senha } = req.body;

  if (!nome || !senha) {
    return res.status(400).json({ error: 'Por favor, forneça um nome e uma senha' });
  }

  const query = 'SELECT id FROM user WHERE nome = ? AND senha = ?';
  db.query(query, [nome, senha], (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Erro ao fazer login' });
    }

    if (result.length === 0) {
      return res.status(401).json({ error: 'Nome ou senha inválidos' });
    }

    const userId = result[0].id;
    const token = jwt.sign({ userId }, 'secreto', { expiresIn: '1h' });

    res.json({ message: 'Login realizado com sucesso', token });
  });
});

// Rota para cadastrar receita
app.post('/cadastrar-receita', authenticateToken, upload.single('imagem'), (req, res) => {
  const { titulo, dificuldade, tempoPreparo, porcoes, ingredientes, utensilios, modoPreparo } = req.body;
  const imagem = req.file ? req.file.filename : null;
  const userId = req.userId;

  const query = 'INSERT INTO receitas (titulo, dificuldade, tempo, porcoes, utensilios, modoPreparo, user_id, imagem) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
  db.query(query, [titulo, dificuldade, tempoPreparo, porcoes, utensilios, modoPreparo, userId, imagem], (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Erro ao cadastrar receita' });
    }

    const receitaId = result.insertId;

    const ingredientesQueries = JSON.parse(ingredientes).map((ingrediente) => {
      return new Promise((resolve, reject) => {
        const ingredienteQuery = 'INSERT INTO ingredientes (nome, quantidade, receita_id) VALUES (?, ?, ?)';
        db.query(ingredienteQuery, [ingrediente.nome, ingrediente.quantidade, receitaId], (err, result) => {
          if (err) {
            return reject(err);
          }
          resolve();
        });
      });
    });

    Promise.all(ingredientesQueries)
      .then(() => {
        res.status(201).json({ message: 'Receita cadastrada com sucesso' });
      })
      .catch((err) => {
        console.error(err);
        res.status(500).json({ error: 'Erro ao cadastrar ingredientes' });
      });
  });
});

app.get('/receitas', authenticateToken, (req, res) => {
  const query = 'SELECT * FROM receitas';
  db.query(query, (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Erro ao buscar receitas' });
    }

    const receitasPromises = results.map((receita) => {
      return new Promise((resolve, reject) => {
        const ingredientesQuery = 'SELECT * FROM ingredientes WHERE receita_id = ?';
        db.query(ingredientesQuery, [receita.id], (err, ingredientes) => {
          if (err) {
            return reject(err);
          }
          receita.ingredientes = ingredientes;
          resolve(receita);
        });
      });
    });

    Promise.all(receitasPromises)
      .then((receitas) => {
        res.json(receitas);
      })
      .catch((err) => {
        console.error(err);
        res.status(500).json({ error: 'Erro ao buscar receitas' });
      });
  });
});

app.get('/receitas', authenticateToken, (req, res) => {
  const search = req.query.search ? `%${req.query.search}%` : '%';

  const query = 'SELECT * FROM receitas WHERE titulo LIKE ?';
  db.query(query, [search], (err, results) => {
    if (err) {
      console.error('Erro ao buscar receitas:', err);
      return res.status(500).json({ error: 'Erro ao buscar receitas' });
    }

    const receitas = results.map((receita) => {
      return {
        id: receita.id,
        titulo: receita.titulo,
        dificuldade: receita.dificuldade,
        tempo: receita.tempo,
        porcoes: receita.porcoes,
        utensilios: receita.utensilios,
        modoPreparo: receita.modoPreparo,
        imagem: receita.imagem,
        ingredientes: []
      };
    });

    // Buscar ingredientes para cada receita
    const receitasPromises = receitas.map((receita) => {
      return new Promise((resolve, reject) => {
        const ingredientesQuery = 'SELECT nome, quantidade FROM ingredientes WHERE receita_id = ?';
        db.query(ingredientesQuery, [receita.id], (err, ingredientes) => {
          if (err) {
            return reject(err);
          }
          receita.ingredientes = ingredientes;
          resolve(receita);
        });
      });
    });

    Promise.all(receitasPromises)
      .then((receitasCompletas) => {
        res.json(receitasCompletas);
      })
      .catch((err) => {
        console.error('Erro ao buscar ingredientes:', err);
        res.status(500).json({ error: 'Erro ao buscar ingredientes' });
      });
  });
});


// Rota para adicionar ingrediente à lista de compras
app.post('/adicionar-ingrediente', authenticateToken, (req, res) => {
  const { ingredienteId } = req.body;
  const userId = req.userId;
  console.log(ingredienteId, userId);

  const query = 'INSERT INTO lista (user_id, ingrediente_id) VALUES (?, ?)';
  db.query(query, [userId, ingredienteId], (err, result) => {
    if (err) {
      console.error('Erro ao adicionar ingrediente à lista de compras:', err);
      return res.status(500).json({ error: 'Erro ao adicionar ingrediente à lista de compras' });
    }
    res.status(201).json({ message: 'Ingrediente adicionado à lista de compras com sucesso' });
  });
});

// Rota para adicionar receita ao planejamento semanal
app.post('/adicionar-planejamento', authenticateToken, (req, res) => {
  const { receitaId, data } = req.body;
  const userId = req.userId;

  const query = 'INSERT INTO planejamento (user_id, receita_id, data) VALUES (?, ?, ?)';
  db.query(query, [userId, receitaId, data], (err, result) => {
    if (err) {
      console.error('Erro ao adicionar receita ao planejamento semanal:', err);
      return res.status(500).json({ error: 'Erro ao adicionar receita ao planejamento semanal' });
    }
    res.status(201).json({ message: 'Receita adicionada ao planejamento semanal com sucesso' });
  });
});

// Rota para buscar ingredientes da lista de compras
app.get('/lista', authenticateToken, (req, res) => {
  const userId = req.userId;

  const query = `
    SELECT ingredientes.nome, ingredientes.quantidade 
    FROM lista 
    JOIN ingredientes ON lista.ingrediente_id = ingredientes.id 
    WHERE lista.user_id = ?
  `;

  db.query(query, [userId], (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Erro ao buscar lista de compras' });
    }
    res.json(results);
  });
});


// server.js
app.get('/planejamento', authenticateToken, (req, res) => {
  const userId = req.userId;

  const query = `
    SELECT p.data, r.titulo
    FROM planejamento p
    JOIN receitas r ON p.receita_id = r.id
    WHERE p.user_id = ?
    ORDER BY p.data;
  `;
  
  db.query(query, [userId], (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Erro ao buscar planejamento' });
    }
    res.json(results);
  });
});


const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
