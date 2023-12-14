const express = require("express");
const app = express();
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const stripe = require("stripe")(process.env.PAYMENT_SECRET);
const port = process.env.PORT || 7000;

// Middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.BD_USER}:${process.env.BD_PASS}@cluster0.ymhbsfp.mongodb.net/?retryWrites=true&w=majority`;

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
    // Connect the client to the server	(optional starting in v4.7)

    const userCollection = client.db("serviceAppDB").collection("users");
    const bookingCollection = client.db("serviceAppDB").collection("bookings");
    const reviewCollection = client.db("serviceAppDB").collection("reviews");
    const paymentCollection = client.db("serviceAppDB").collection("payment");

    // jwt related api
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.SECRET_TOKEN, {
        expiresIn: "1h",
      });
      res.send({ token });
    });

    // middlewares
    const verifyToken = (req, res, next) => {
      // console.log('inside verify token', req.headers.authorization);
      if (!req.headers.authorization) {
        return res.status(401).send({ message: "unauthorized access" });
      }
      const token = req.headers.authorization.split(" ")[1];
      jwt.verify(token, process.env.SECRET_TOKEN, (err, decoded) => {
        if (err) {
          return res.status(401).send({ message: "unauthorized access" });
        }
        req.decoded = decoded;
        next();
      });
    };

    // use verify admin after verifyToken
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isAdmin = user?.role === "admin";
      if (!isAdmin) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // users related api
    app.get("/users", verifyToken, async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    app.get("/users/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const result = await userCollection.find(query).toArray();
      res.send(result);
    });

    app.get("/users/admin/:email", verifyToken, async (req, res) => {
      const email = req.params.email;

      if (email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" });
      }

      const query = { email: email };
      const user = await userCollection.findOne(query);
      let admin = false;
      if (user) {
        admin = user?.role === "admin";
      }
      res.send({ admin });
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await userCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: "user already exists", insertedId: null });
      }
      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    // user profile
    app.patch("/users/:email", async (req, res) => {
      const item = req.body;
      const email = req.params.email;
      const filter = { email: email };
      const updatedDoc = {
        $set: {
          image: item.image,
        },
      };
      const result = await userCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    // Parcel related data
    app.post("/bookings", async (req, res) => {
      const booking = req.body;
      const result = await bookingCollection.insertOne(booking);
      res.send(result);
    });

    // Add this after your existing routes

    // Retrieve all bookings (accessible only by admin)

    app.get("/bookings", async (req, res) => {
      const result = await bookingCollection.find().toArray();
      res.send(result);
    });

    // Retrieve bookings by email
    app.get("/bookings", verifyToken, async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const result = await bookingCollection.find(query).toArray();
      res.send(result);
    });

    // Retrieve a booking by ID
    app.get("/bookings/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await bookingCollection.findOne(query);
      res.send(result);
    });

    app.get("/bookings", verifyToken, async (req, res) => {
      const user = req.user; // Assuming your authentication middleware adds the user to the request

      const query = { email: user.email };
      const result = await bookingCollection.find(query).toArray();
      res.send(result);
    });

    app.get("/bookings", verifyToken, async (req, res) => {
      try {
        const startDate = req.query.startDate;
        const endDate = req.query.endDate;

        let dateFilter = {};

        // Add date range filtering if both startDate and endDate are provided
        if (startDate && endDate) {
          dateFilter = {
            deliveryDate: {
              $gte: new Date(startDate),
              $lte: new Date(endDate),
            },
          };
        }

        // Merge date filter with other existing filters if any
        const filters = { ...dateFilter /* Add other filters if needed */ };

        const result = await bookingCollection.find(filters).toArray();
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send("Internal Server Error");
      }
    });

    // Update bookings
    app.patch("/bookings/:id", async (req, res) => {
      const item = req.body;
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          parcelType: item.parcelType,
          requestedDeliveryDate: item.requestedDeliveryDate,
          price: item.price,
          deliveryManId: item.deliveryManId,
          phoneNumber: item.phoneNumber,
        },
      };
      const result = await bookingCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    // Update status and deliveryManId of a booking
    app.patch("/bookings/update-status/:id", async (req, res) => {
      try {
        const { status, deliveryManId } = req.body;
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };

        const updatedDoc = {
          $set: {
            status: status,
            deliveryManId: deliveryManId,
          },
        };

        const result = await bookingCollection.updateOne(filter, updatedDoc);

        res.send(result);
      } catch (error) {
        console.error(
          "Error updating booking status and deliveryManId:",
          error
        );
        res.status(500).send({ message: "Internal server error" });
      }
    });

    app.delete("/bookings/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await bookingCollection.deleteOne(query);
      res.send(result);
    });

    app.delete("/users/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await userCollection.deleteOne(query);
      res.send(result);
    });

    // Admin

    app.get(
      "/users/admin/:email",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const email = req.params.email;

        if (email !== req.decoded.email) {
          return res.status(403).send({ message: "forbidden access" });
        }

        const query = { email: email };
        const user = await userCollection.findOne(query);
        let admin = false;
        if (user) {
          admin = user?.role === "admin";
        }
        res.send({ admin });
      }
    );

    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await userCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: "user already exists", insertedId: null });
      }
      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    app.post("/reviews", async (req, res) => {
      const review = req.body;
      const result = await reviewCollection.insertOne(review);
      res.send(result);
    });

    app.get("/reviews", async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const result = await reviewCollection.find(query).toArray();
      res.send(result);
    });

    app.patch(
      "/users/deliveryMan/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            role: "deliveryMan",
          },
        };
        const result = await userCollection.updateOne(filter, updatedDoc);
        res.send(result);
      }
    );

    app.patch(
      "/users/admin/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            role: "admin",
          },
        };
        const result = await userCollection.updateOne(filter, updatedDoc);
        res.send(result);
      }
    );

    // Delivery Man
    app.get("/users/deliveryMan/:email", verifyToken, async (req, res) => {
      const email = req.params.email;

      if (email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" });
      }

      const query = { email: email };
      const user = await userCollection.findOne(query);
      let admin = false;
      if (user) {
        deliveryMan = user?.role === "deliveryMan";
      }
      res.send({ deliveryMan });
    });

    // Payment;
    app.post("/create-payment-intent", async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    app.get("/payments/:email", verifyToken, async (req, res) => {
      const query = { email: req.params.email };
      if (req.params.email !== req.decoded.email) {
        res.status(403).send({ message: "forbidden access" });
      }
      const result = await paymentCollection.find(query).toArray();
      res.send(result);
    });

    // Payment related API
    app.post("/payments", async (req, res) => {
      const payment = req.body;
      const paymentResult = await paymentCollection.insertOne(payment);
      const query = {
        _id: {
          $in: payment.cartIds.map((id) => new ObjectId(id)),
        },
      };
      const deleteResult = await bookingCollection.deleteMany(query);
      res.send({ paymentResult, deleteResult });
    });

    app.get("/app-statistics", async (req, res) => {
      const bookedParcels = await bookingCollection.countDocuments();
      const deliveredParcels = await bookingCollection.countDocuments({
        status: "delivered",
      });
      const registeredUsers = await userCollection.countDocuments();

      res.send({
        bookedParcels,
        deliveredParcels,
        registeredUsers,
      });
    });

    // Admin Related Api
    app.get("/admin-stats", verifyToken, verifyAdmin, async (req, res) => {
      const users = await userCollection.estimatedDocumentCount();
      const bookings = await bookingCollection.estimatedDocumentCount();

      res.send({
        users,
        bookings,
      });
    });

    // Send a ping to confirm a successful connection
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Data is Coming.....");
});

app.listen(port, () => {
  console.log(`Parcel is coming on port ${port}`);
});
