const {
  MongoClient,
  ServerApiVersion,
  ObjectId,
  ConnectionCheckOutStartedEvent,
} = require("mongodb");
const express = require("express");
const app = express();
const port = process.env.PORT || 5000;
const cors = require("cors");
app.use(cors());
app.use(express.json());
require("dotenv").config();
var jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.Stripe_Key);
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.bbqqyyb.mongodb.net/?retryWrites=true&w=majority`;
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    const appointmentColection = client
      .db("doctor's-portal")
      .collection("appointmentOptions");
    const bookingsColection = client
      .db("doctor's-portal")
      .collection("bookings");
    const usersColection = client.db("doctor's-portal").collection("users");
    const doctorsColection = client.db("doctor's-portal").collection("doctors");
    const paymentsColection = client.db("doctor's-portal").collection("payments");

    const verifyAdmin = async (req, res, next) => {
      const id = req.params.id;
      const decodedEmail = req.decoded.email;
      const query = { email: decodedEmail };
      const users = await usersColection.findOne(query);
      if (users.role !== "admin") {
        return res.status(401).send({ message: "forbidden" });
      }
      next();
    };

    app.post("/create-payment-intent", async (req, res) => {
      const booking = req.body;
      const price = booking.price;
      const amount = price * 100;
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        "payment_method_types":[
          "card"
        ]
      });
      res.send({
        clientSecret: paymentIntent.client_secret
      })
    });

    app.get("/appointmentOptions", async (req, res) => {
      const date = req.query.date;
      const query = {};
      const options = await appointmentColection.find(query).toArray();
      const bookingQuery = { selectedDate: date };
      const alreadyBooked = await bookingsColection
        .find(bookingQuery)
        .toArray();

      options.forEach((option) => {
        const optionBooked = alreadyBooked.filter(
          (book) => book.treatment === option.name
        );
        const bookedSlots = optionBooked.map((book) => book.slot);
        const remainingSlots = option.slots.filter(
          (slot) => !bookedSlots.includes(slot)
        );
        option.slots = remainingSlots;
      });
      res.send(options);
    });

    function verifyJwt(req, res, next) {
      const authHeader = req.headers.autherization;
      if (!authHeader) { 
        return res.status(401).send("Unauthorized acccess");
      }
      const token = authHeader.split(" ")[1];
      jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
        if (err) {
          return res.status(403).send({ message: "forbidden access" });
        }
        req.decoded = decoded;
        next();
      });
    }

    app.post("/bookings", async (req, res) => {
      const booking = req.body;
      const query = {
        selectedDate: booking.selectedDate,
        treatment: booking.treatment,
      };
      const alreadyBooked = await bookingsColection.find(query).toArray();
      if (alreadyBooked.length) {
        const message = `You already have an booking on ${booking.selectedDate}`;
        return res.send({ acknowleged: false, message });
      }
      const result = await bookingsColection.insertOne(booking);
      res.send(result);
    });

    app.get("/bookings", verifyJwt, async (req, res) => {
      const decodedEmail = req.decoded.email;
      const email = req.query.email;
      if (email !== decodedEmail) {
        return res.status(403).send({ message: "foribidden access" });
      }
      const query = { email: email };
      const bookings = await bookingsColection.find(query).toArray();
      res.send(bookings);
    });

    app.get("/bookings/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const bookings = await bookingsColection.findOne(query);
      res.send(bookings);
    });

    app.get("/users", async (req, res) => {
      const query = {};
      const users = await usersColection.find(query).toArray();
      res.send(users);
    });

    app.delete("/user/:id", async (req, res) => {
      const id = req.params.id
      const query = {_id: new ObjectId(id)};
      const users = await usersColection.deleteOne(query).toArray();
      res.send(users);
    });

    app.get("/jwt", async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const user = await usersColection.findOne(query);
      if (user) {
        var token = jwt.sign({ email }, process.env.ACCESS_TOKEN, {
          expiresIn: "2d",
        });
        return res.send({ accessToken: token });
      }
      return res.status(403).send({ accessToken: "" });
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      const result = await usersColection.insertOne(user);
      res.send(result);
    });


    app.post("/payments", async (req, res) => {
      const payment = req.body;
      const result = await paymentsColection.insertOne(payment); 
      const id = payment.bookingId;
      const filter = {_id: new ObjectId(id)}
      const updatedDoc = {
        $set: {
          paid: true,
          transactionId: payment.transactionId 
        }
      }
      const updatedREsult = await bookingsColection.updateOne(filter, updatedDoc)
      res.send(result);
    });

    app.put("/user/admin/:id", verifyJwt, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const options = { upsert: true };
      const updatedDoc = {
        $set: {
          role: "admin",
        },
      };
      const result = await usersColection.updateOne(
        filter,
        updatedDoc,
        options
      );
      res.send(result);
    });

    app.get("/users/admin/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await usersColection.findOne(query);
      res.send({ isAdmin: user.role == "admin" });
    });

    app.get("/appointmentSpecialty", async (req, res) => {
      const query = {};
      const result = await appointmentColection
        .find(query)
        .project({ name: 1 })
        .toArray();
      res.send(result);
    });

    app.get("/doctors", verifyJwt, verifyAdmin, async (req, res) => {
      const query = {};
      const result = await doctorsColection.find(query).toArray();
      res.send(result);
    });

    app.post("/doctors", verifyJwt, verifyAdmin, async (req, res) => {
      const doctor = req.body;
      const result = await doctorsColection.insertOne(doctor);
      res.send(result);
    });

    app.delete("/doctors/:id", verifyJwt, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await doctorsColection.deleteOne(query);
      res.send(result);
    });

    app.get("/addPrice", async (req, res) => {
      const filter = {};
      const options = { upsert: true };
      const updatedDoc = {
        $set: {
          price: 99,
        },
      };
      const result = await appointmentColection.updateMany(
        filter,
        updatedDoc,
        options
      );
      res.send(result);
    });
  } finally {
  }
}
run().catch((er) => console.log(er));

app.get("/", (req, res) => {
  res.send("doctor's portal server running");
});

app.listen(port, () => {
  console.log(`doctor's portal running on port ${port}`);
});
